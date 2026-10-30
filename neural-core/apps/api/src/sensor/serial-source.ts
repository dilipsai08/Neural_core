import { SerialPort } from "serialport";
import { ADC_BITS_DEFAULT, type FocusSource, type RawSample } from "@neural-core/shared";
import { RateAdapter, StreamDecoder, type Protocol } from "./stream-decoder.js";

export interface SerialSourceOptions {
  path: string;
  baud: number;
  /** Known sample rate of the board (Chords on the UNO R4: 500). 0 or unset = measure it. */
  rateHz?: number;
  log: (msg: string) => void;
}

/** Bauds tried in turn until the bytes make sense: ours (115200) and Chords on the UNO R4 (230400). */
const CANDIDATE_BAUDS = [115200, 230400, 250000, 57600, 9600];
const DETECT_TIMEOUT_MS = 6000;
/** How often START is re-sent while waiting for the first recognisable data. */
const START_RETRY_MS = 1000;

/**
 * Reads the Arduino over USB serial. Works with the Neural Core sketch
 * (text, 250 Hz) and with the Upside Down Labs Chords firmware (binary,
 * 500 Hz on the UNO R4), detected from the data. If nothing recognisable
 * arrives it tries the next baud rate, and it reconnects with backoff if the
 * cable is pulled or the board resets. Output is always 250 Hz.
 */
export class SerialSource implements FocusSource {
  readonly kind = "serial" as const;
  adcMax = 2 ** ADC_BITS_DEFAULT - 1;
  connected = false;
  lastError: string | null = null;
  protocol: Protocol = "unknown";
  baud: number;
  inputRateHz: number | null = null;

  private port: SerialPort | null = null;
  private listeners: Array<(s: RawSample) => void> = [];
  private bitsListeners: Array<(adcMax: number) => void> = [];
  private stopped = true;
  private retryMs = 1000;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private detectTimer: ReturnType<typeof setTimeout> | null = null;
  private startTimer: ReturnType<typeof setInterval> | null = null;
  private bauds: number[];
  private baudIndex = 0;

  constructor(private readonly opts: SerialSourceOptions) {
    this.bauds = [opts.baud, ...CANDIDATE_BAUDS.filter((b) => b !== opts.baud)];
    this.baud = opts.baud;
  }

  async start(): Promise<void> {
    this.stopped = false;
    this.open();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    if (this.detectTimer) clearTimeout(this.detectTimer);
    if (this.startTimer) clearInterval(this.startTimer);
    const port = this.port;
    this.port = null;
    if (port?.isOpen) {
      // Chords firmware stops streaming on STOP; the Neural Core sketch ignores it.
      port.write("STOP\n");
      await new Promise<void>((resolve) => port.drain(() => port.close(() => resolve())));
    }
    this.connected = false;
  }

  onSample(cb: (s: RawSample) => void): void {
    this.listeners.push(cb);
  }

  onAdcMax(cb: (adcMax: number) => void): void {
    this.bitsListeners.push(cb);
  }

  describe(): string {
    if (this.protocol === "unknown") return `${this.opts.path} @ ${this.baud} · detecting firmware…`;
    const fw = this.protocol === "chords" ? "Chords firmware" : "Neural Core sketch";
    const rate = this.inputRateHz ? ` · ${this.inputRateHz} Hz` : "";
    return `${this.opts.path} @ ${this.baud} · ${fw}${rate}`;
  }

  private open(): void {
    if (this.stopped) return;
    this.baud = this.bauds[this.baudIndex % this.bauds.length]!;
    const port = new SerialPort({ path: this.opts.path, baudRate: this.baud, autoOpen: false });
    const decoder = new StreamDecoder();
    const rate = new RateAdapter(
      (counts) => {
        const s: RawSample = { t: Date.now(), counts };
        for (const cb of this.listeners) cb(s);
      },
      undefined,
      undefined,
      this.opts.rateHz ?? 0,
    );
    if (rate.rateHz !== null) {
      this.inputRateHz = rate.rateHz;
      this.opts.log(`serial ${this.opts.path}: sample rate set to ${rate.rateHz} Hz${rate.factor > 1 ? `, averaging every ${rate.factor} samples to 250 Hz` : ""}`);
    }
    this.port = port;
    this.protocol = "unknown";
    this.inputRateHz = null;

    let bytesIn = 0;
    let firstBytes = "";
    port.on("data", (chunk: Buffer) => {
      bytesIn += chunk.length;
      if (firstBytes.length < 48) firstBytes += chunk.subarray(0, 16).toString("hex").replace(/(..)/g, "$1 ");
      const out = decoder.push(chunk);
      if (decoder.protocol !== "unknown" && this.protocol === "unknown") {
        this.protocol = decoder.protocol;
        if (this.detectTimer) clearTimeout(this.detectTimer);
        if (this.startTimer) clearInterval(this.startTimer);
        this.baudIndex = this.bauds.indexOf(this.baud);
        this.opts.log(
          `serial ${this.opts.path}: ${decoder.protocol === "chords" ? `Chords firmware, ${decoder.channels} channels (using A0)` : "Neural Core sketch"} @ ${this.baud} baud`,
        );
      }
      if (out.header) this.opts.log(`serial ${this.opts.path}: firmware ${out.header}`);
      if (out.bits) {
        this.adcMax = 2 ** out.bits - 1;
        for (const cb of this.bitsListeners) cb(this.adcMax);
      }
      const before = rate.rateHz;
      rate.push(out.samples, Date.now());
      if (before === null && rate.rateHz !== null) {
        this.inputRateHz = rate.rateHz;
        this.opts.log(
          `serial ${this.opts.path}: ${rate.rateHz} Hz in${rate.measuredHz !== rate.rateHz ? ` (measured ≈${rate.measuredHz})` : ""}` +
            (rate.mode === "resample"
              ? `: unusual rate, resampling to 250 Hz (expected 250 or 500; run pnpm sensor:check --raw to see why)`
              : rate.factor > 1
                ? `, averaging every ${rate.factor} samples to 250 Hz`
                : ""),
        );
        if (decoder.stats.lostPackets > 0) {
          this.opts.log(`serial ${this.opts.path}: ${decoder.stats.lostPackets} packets lost in transit so far (gaps are filled)`);
        }
      }
    });

    port.on("close", () => {
      this.connected = false;
      if (this.detectTimer) clearTimeout(this.detectTimer);
      if (this.startTimer) clearInterval(this.startTimer);
      if (!this.stopped) this.opts.log(`serial ${this.opts.path}: closed`);
      this.scheduleRetry();
    });
    port.on("error", (err) => {
      this.lastError = err.message;
      this.opts.log(`serial ${this.opts.path}: ${err.message}`);
    });

    port.open((err) => {
      if (err) {
        this.lastError = err.message;
        this.connected = false;
        this.opts.log(`serial ${this.opts.path}: open failed, ${err.message}`);
        this.scheduleRetry();
        return;
      }
      this.connected = true;
      this.lastError = null;
      this.retryMs = 1000;
      this.opts.log(`serial ${this.opts.path}: open @ ${this.baud} baud`);
      // Native-USB boards (UNO R4 Minima) only transmit once the host raises DTR,
      // which the Arduino IDE and Chrome do automatically.
      port.set({ dtr: true, rts: true }, () => undefined);
      // "START" makes the Chords firmware stream; "i" makes the Neural Core sketch reprint its header.
      // Wait for the USB link to settle, then keep asking until data arrives.
      const poke = () => {
        if (port.isOpen && this.protocol === "unknown") port.write("START\ni\n");
      };
      setTimeout(poke, 400);
      this.startTimer = setInterval(poke, START_RETRY_MS);
      this.detectTimer = setTimeout(() => {
        if (this.startTimer) clearInterval(this.startTimer);
        if (this.protocol !== "unknown" || this.stopped) return;
        this.baudIndex += 1;
        const next = this.bauds[this.baudIndex % this.bauds.length]!;
        this.opts.log(
          bytesIn === 0
            ? `serial ${this.opts.path}: no bytes at all @ ${this.baud} (board not sending: close other programs using the port, replug USB or press RESET); trying ${next} baud`
            : `serial ${this.opts.path}: ${bytesIn} bytes but not a known format @ ${this.baud} (first bytes: ${firstBytes.trim()}); trying ${next} baud`,
        );
        port.close();
      }, DETECT_TIMEOUT_MS);
    });
  }

  private scheduleRetry(): void {
    if (this.stopped || this.retryTimer) return;
    // Switching baud is instant; a real disconnect backs off.
    const delay = this.protocol === "unknown" && this.lastError === null ? 200 : this.retryMs;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.open();
    }, delay);
    if (delay === this.retryMs) this.retryMs = Math.min(this.retryMs * 2, 5000);
  }
}

export async function listSerialPorts(): Promise<Array<{ path: string; label: string }>> {
  const ports = await SerialPort.list();
  return ports.map((p) => ({
    path: p.path,
    label: [p.manufacturer, p.vendorId && `${p.vendorId}:${p.productId}`].filter(Boolean).join(" ") || p.path,
  }));
}
