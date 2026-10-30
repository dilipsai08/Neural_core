import { createWriteStream, mkdirSync, type WriteStream } from "node:fs";
import path from "node:path";
import {
  CALIBRATION_FOCUS_S,
  CALIBRATION_HIGH_PERCENTILE,
  CALIBRATION_LOW_PERCENTILE,
  CALIBRATION_MIN_SPAN,
  CALIBRATION_RELAX_S,
  FOCUS_HISTORY_S,
  FOCUS_OUTPUT_RATE_HZ,
  SAMPLE_RATE_HZ,
  SOURCE_STALE_MS,
  percentile,
  type Calibration,
  type CalibrationMessage,
  type CalibrationPhase,
  type FocusFrame,
  type FocusSource,
  type SignalFrame,
  type SignalQuality,
  type SourceKind,
  type StationStatus,
} from "@neural-core/shared";
import {
  BridgeSource,
  FakeSource,
  FocusProcessor,
  FocusScorer,
  ReplaySource,
  SerialSource,
  type Analysis,
} from "../sensor/index.js";

export interface StationHub {
  focus(frame: FocusFrame): void;
  signal(frame: SignalFrame): void;
  calibration(msg: CalibrationMessage): void;
  status(status: StationStatus): void;
}

export interface StationDeps {
  hub: StationHub;
  mainsHz: number;
  baud: number;
  serialRate: number;
  dataDir: string;
  defaultCalibration: () => Calibration;
  onCalibrated: (station: number, playerId: number | null, c: Calibration) => void;
  log: (msg: string) => void;
}

interface CalibrationRun {
  phase: CalibrationPhase;
  values: number[];
  started: number;
  durationMs: number;
}

export class Station {
  readonly label: string;
  private source: FocusSource | null = null;
  private sourceDetail = "";
  private processor: FocusProcessor;
  private scorer: FocusScorer;
  private calibration: Calibration | null = null;
  private calibrationPlayer: number | null = null;
  private cal: CalibrationRun | null = null;
  private relaxValues: number[] | null = null;
  private history = new Map<number, number>();
  private historyKeys: number[] = [];
  private lastSampleAt = 0;
  private lastFrameAt: number | null = null;
  private quality: SignalQuality = "bad";
  private waveBuf: number[] = [];
  private analyses = 0;
  private recorder: WriteStream | null = null;
  private staleTimer: ReturnType<typeof setInterval>;
  private wasConnected = false;
  private generation = 0;

  playerId: number | null = null;
  runId: number | null = null;
  paused = false;

  constructor(
    readonly id: number,
    private readonly deps: StationDeps,
  ) {
    this.label = `Station ${String(id).padStart(2, "0")}`;
    this.processor = new FocusProcessor({ fs: SAMPLE_RATE_HZ, adcMax: 16383, mainsHz: deps.mainsHz });
    this.scorer = new FocusScorer(deps.defaultCalibration());
    this.staleTimer = setInterval(() => this.checkStale(), 500);
  }

  // ─── Source management ───────────────────────────────────────────────
  get sourceKind(): SourceKind {
    return this.source?.kind ?? "none";
  }

  async setSource(kind: SourceKind, opts: { port?: string; baud?: number; file?: string } = {}): Promise<void> {
    await this.source?.stop();
    this.source = null;
    this.generation += 1;
    const gen = this.generation;
    this.processor.reset();
    this.scorer.reset();
    this.quality = "bad";

    let src: FocusSource | null = null;
    switch (kind) {
      case "fake":
        src = new FakeSource();
        this.sourceDetail = "Synthetic EEG";
        break;
      case "serial": {
        if (!opts.port) throw new Error("serial source needs a port");
        const serial = new SerialSource({
          path: opts.port,
          baud: opts.baud ?? this.deps.baud,
          rateHz: this.deps.serialRate,
          log: this.deps.log,
        });
        serial.onAdcMax((max) => this.processor.setAdcMax(max));
        src = serial;
        this.sourceDetail = `${opts.port} @ ${opts.baud ?? this.deps.baud}`;
        break;
      }
      case "bridge": {
        const bridge = new BridgeSource();
        bridge.onAdcMax((max) => this.processor.setAdcMax(max));
        src = bridge;
        this.sourceDetail = "Waiting for bridge";
        break;
      }
      case "replay":
        if (!opts.file) throw new Error("replay source needs a file");
        src = new ReplaySource(opts.file);
        this.sourceDetail = path.basename(opts.file);
        break;
      case "none":
        this.sourceDetail = "No sensor selected";
        break;
    }

    if (src) {
      this.processor.setAdcMax(src.adcMax);
      src.onSample((s) => {
        if (gen === this.generation) this.ingest(s.counts);
      });
      this.source = src;
      await src.start();
    }
    this.deps.log(`${this.label}: source → ${kind} ${this.sourceDetail}`);
    this.broadcastStatus();
  }

  /** Samples from a remote bridge. Switches the station to bridge mode if needed. */
  async ingestBridge(counts: readonly number[], bits: number, from: string): Promise<void> {
    if (!(this.source instanceof BridgeSource)) await this.setSource("bridge");
    const bridge = this.source as BridgeSource;
    if (this.sourceDetail !== from) {
      this.sourceDetail = from;
      this.broadcastStatus();
    }
    bridge.ingest(counts, bits);
  }

  setFakeTarget(target: number | null): void {
    if (this.source instanceof FakeSource) this.source.target = target;
    this.broadcastStatus();
  }

  // ─── Sample path ─────────────────────────────────────────────────────
  private ingest(counts: number): void {
    this.lastSampleAt = Date.now();
    this.recorder?.write(`${counts}\n`);
    const a = this.processor.push(counts);
    if (a) this.onAnalysis(a);
  }

  private onAnalysis(a: Analysis): void {
    const now = Date.now();
    const s = this.scorer.next(a);
    const frame: FocusFrame = {
      type: "focus",
      station: this.id,
      t: now,
      score: s.score,
      raw: s.raw,
      quality: a.quality,
      artifact: a.artifact,
    };
    this.remember(now, s.score);
    this.lastFrameAt = now;
    const qualityChanged = a.quality !== this.quality;
    this.quality = a.quality;
    this.deps.hub.focus(frame);

    this.waveBuf.push(...a.wave);
    this.analyses += 1;
    if (this.analyses % (FOCUS_OUTPUT_RATE_HZ / 2) === 0) {
      this.deps.hub.signal({
        type: "signal",
        station: this.id,
        t: now,
        wave: this.waveBuf,
        bands: a.bands,
        index: Math.round(a.index * 1000) / 1000,
        quality: a.quality,
        mainsRatio: a.mainsRatio,
        railShare: a.railShare,
      });
      this.waveBuf = [];
    }

    if (this.cal) this.collectCalibration(a);
    if (qualityChanged) this.broadcastStatus();
  }

  private remember(t: number, score: number): void {
    this.history.set(t, score);
    this.historyKeys.push(t);
    const cutoff = t - FOCUS_HISTORY_S * 1000;
    while (this.historyKeys.length && this.historyKeys[0]! < cutoff) {
      this.history.delete(this.historyKeys.shift()!);
    }
  }

  /** Score of the frame broadcast at server time t, if this station sent it. */
  frameScore(t: number): number | undefined {
    return this.history.get(t);
  }

  private checkStale(): void {
    const connected = this.isConnected();
    if (!connected && this.quality !== "bad") this.quality = "bad";
    if (connected !== this.wasConnected) {
      this.wasConnected = connected;
      this.broadcastStatus();
    }
  }

  private isConnected(): boolean {
    if (!this.source) return false;
    if (this.source instanceof SerialSource && !this.source.connected) return false;
    return Date.now() - this.lastSampleAt < SOURCE_STALE_MS;
  }

  // ─── Calibration ─────────────────────────────────────────────────────
  startCalibration(phase: CalibrationPhase): void {
    if (phase === "focus" && !this.relaxValues) throw new Error("Run the relax phase first");
    if (phase === "relax") this.relaxValues = null;
    const seconds = phase === "relax" ? CALIBRATION_RELAX_S : CALIBRATION_FOCUS_S;
    this.cal = { phase, values: [], started: Date.now(), durationMs: seconds * 1000 };
    if (this.source instanceof FakeSource) this.source.calibrationHint = phase;
    this.emitCalibration(0, false, null, null);
    this.broadcastStatus();
  }

  private collectCalibration(a: Analysis): void {
    const cal = this.cal!;
    if (a.artifact === "none" && a.quality !== "bad") cal.values.push(a.index);
    const progress = Math.min(1, (Date.now() - cal.started) / cal.durationMs);
    if (progress < 1) {
      if (this.analyses % 2 === 0) this.emitCalibration(progress, false, null, null);
      return;
    }
    this.cal = null;
    if (this.source instanceof FakeSource) this.source.calibrationHint = null;

    const expected = (cal.durationMs / 1000) * FOCUS_OUTPUT_RATE_HZ;
    if (cal.values.length < expected * 0.4) {
      this.emitCalibration(1, true, null, "Too much movement or noise. Sit still, relax the jaw and retry.", cal.phase);
      this.broadcastStatus();
      return;
    }
    if (cal.phase === "relax") {
      this.relaxValues = cal.values;
      this.emitCalibration(1, true, null, null, "relax");
      this.broadcastStatus();
      return;
    }

    const relax = this.relaxValues ?? [];
    let low = percentile(relax, CALIBRATION_LOW_PERCENTILE);
    let high = percentile(cal.values, CALIBRATION_HIGH_PERCENTILE);
    if (high - low < CALIBRATION_MIN_SPAN) {
      // Weak separation: fall back to the spread of this player's own signal.
      const all = [...relax, ...cal.values];
      low = percentile(all, CALIBRATION_LOW_PERCENTILE);
      high = percentile(all, CALIBRATION_HIGH_PERCENTILE);
    }
    if (high - low < CALIBRATION_MIN_SPAN) {
      this.emitCalibration(1, true, null, "Signal range too narrow. Check the forehead electrode and retry, or skip.", "focus");
      this.broadcastStatus();
      return;
    }
    const result: Calibration = { low: round3(low), high: round3(high), source: "measured" };
    this.applyCalibration(result);
    this.emitCalibration(1, true, result, null, "focus");
  }

  skipCalibration(): Calibration {
    const c = this.deps.defaultCalibration();
    this.applyCalibration(c);
    this.emitCalibration(1, true, c, null, "focus");
    return c;
  }

  applyCalibration(c: Calibration): void {
    this.cal = null;
    if (this.source instanceof FakeSource) this.source.calibrationHint = null;
    this.calibration = c;
    this.calibrationPlayer = this.playerId;
    this.scorer.setCalibration(c);
    this.scorer.reset();
    if (c.source === "measured") this.deps.onCalibrated(this.id, this.playerId, c);
    this.broadcastStatus();
  }

  currentCalibration(): Calibration | null {
    return this.calibration;
  }

  private emitCalibration(
    progress: number,
    done: boolean,
    result: Calibration | null,
    error: string | null,
    phase: CalibrationPhase | undefined = this.cal?.phase,
  ): void {
    this.deps.hub.calibration({
      type: "calibration",
      station: this.id,
      phase: phase ?? "focus",
      progress,
      done,
      result,
      error,
    });
  }

  // ─── Session ─────────────────────────────────────────────────────────
  assignPlayer(playerId: number): void {
    if (this.playerId !== playerId) {
      this.playerId = playerId;
      if (this.calibrationPlayer !== playerId) {
        this.calibration = null;
        this.relaxValues = null;
        this.scorer.setCalibration(this.deps.defaultCalibration());
      }
    }
    this.broadcastStatus();
  }

  reset(): void {
    this.playerId = null;
    this.runId = null;
    this.paused = false;
    this.cal = null;
    this.relaxValues = null;
    this.calibration = null;
    this.calibrationPlayer = null;
    this.scorer.setCalibration(this.deps.defaultCalibration());
    this.broadcastStatus();
  }

  // ─── Recording ───────────────────────────────────────────────────────
  setRecording(on: boolean): string | null {
    if (!on) {
      this.recorder?.end();
      this.recorder = null;
      this.broadcastStatus();
      return null;
    }
    if (this.recorder) return null;
    const dir = path.join(this.deps.dataDir, "recordings");
    mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `station-${this.id}-${new Date().toISOString().replace(/[:.]/g, "-")}.csv`);
    this.recorder = createWriteStream(file);
    const bits = Math.round(Math.log2((this.source?.adcMax ?? 16383) + 1));
    this.recorder.write(`#NC1 fs=${SAMPLE_RATE_HZ} bits=${bits} station=${this.id}\n`);
    this.broadcastStatus();
    return file;
  }

  // ─── Status ──────────────────────────────────────────────────────────
  status(): StationStatus & { recording: boolean } {
    return {
      id: this.id,
      label: this.label,
      source: this.sourceKind,
      sourceDetail: this.source instanceof SerialSource ? this.source.describe() : this.sourceDetail,
      connected: this.isConnected(),
      quality: this.isConnected() ? this.quality : "bad",
      lastFrameAt: this.lastFrameAt,
      calibration: this.calibration,
      calibrating: this.cal?.phase ?? null,
      playerId: this.playerId,
      runId: this.runId,
      paused: this.paused,
      fakeTarget: this.source instanceof FakeSource ? this.source.target : null,
      recording: this.recorder !== null,
    };
  }

  broadcastStatus(): void {
    this.deps.hub.status(this.status());
  }

  async dispose(): Promise<void> {
    clearInterval(this.staleTimer);
    this.recorder?.end();
    await this.source?.stop();
  }
}

function round3(v: number): number {
  return Math.round(v * 1000) / 1000;
}

