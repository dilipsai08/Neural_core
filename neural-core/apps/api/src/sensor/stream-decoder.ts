import { SAMPLE_RATE_HZ } from "@neural-core/shared";
import { parseSerialLine } from "./serial-protocol.js";

/**
 * Decodes the raw byte stream from the Arduino. Two firmwares are understood,
 * detected automatically from the bytes themselves:
 *
 *   text    firmware/neural_core_streamer: one ADC value per line, "#NC1 ..." header
 *   chords  Upside Down Labs Chords firmware (the one the Chords web visualiser
 *           uses): binary packets
 *             0xC7 0x7C <counter> <ch0 hi> <ch0 lo> ... <chN hi> <chN lo> 0x01
 *           The channel count and byte order are worked out from the data.
 *
 * Only channel 0 is used; our firmware samples it from A1, where the BioAmp EXG Pill OUT is wired.
 */
export type Protocol = "unknown" | "text" | "chords";

export interface DecodedBatch {
  samples: number[];
  /** Set once the ADC resolution is known (from the text header or the data range). */
  bits: number | null;
  header: string | null;
}

const SYNC1 = 0xc7;
const SYNC2 = 0x7c;
const END = 0x01;
const MAX_CHANNELS = 16;
const DETECT_LIMIT = 4096;
/** Largest run of lost packets that is filled by interpolation. */
const MAX_FILL = 64;

export class StreamDecoder {
  protocol: Protocol = "unknown";
  channels = 0;
  bits: number | null = null;
  private buf = new Uint8Array(0);
  private text = "";
  private packetLen = 0;
  private bigEndian = true;
  private seenMax = 0;
  private rangeSamples = 0;
  private lastCounter: number | null = null;
  private lastValue: number | null = null;
  /** Running totals for diagnostics (pnpm sensor:check --raw). */
  readonly stats = { packets: 0, skippedBytes: 0, lostPackets: 0 };
  get byteOrder(): "big-endian" | "little-endian" {
    return this.bigEndian ? "big-endian" : "little-endian";
  }

  push(chunk: Uint8Array): DecodedBatch {
    const out: DecodedBatch = { samples: [], bits: null, header: null };
    if (this.protocol === "text") {
      this.pushText(chunk, out);
      return out;
    }
    this.append(chunk);
    if (this.protocol === "unknown") this.detect(out);
    if (this.protocol === "chords") this.readPackets(out);
    if (this.protocol === "unknown" && this.buf.length > DETECT_LIMIT) {
      // Keep only the tail while we wait for something recognisable.
      this.buf = this.buf.slice(this.buf.length - DETECT_LIMIT / 2);
    }
    return out;
  }

  private append(chunk: Uint8Array): void {
    const next = new Uint8Array(this.buf.length + chunk.length);
    next.set(this.buf);
    next.set(chunk, this.buf.length);
    this.buf = next;
  }

  private detect(out: DecodedBatch): void {
    const b = this.buf;
    // Chords: three consecutive packets of the same length, framed by sync and end bytes.
    for (let i = 0; i + 1 < b.length; i++) {
      if (b[i] !== SYNC1 || b[i + 1] !== SYNC2) continue;
      for (let n = 1; n <= MAX_CHANNELS; n++) {
        const len = 4 + 2 * n;
        if (i + 3 * len + 2 > b.length) break;
        let ok = true;
        for (let k = 0; k < 3 && ok; k++) {
          const p = i + k * len;
          ok = b[p] === SYNC1 && b[p + 1] === SYNC2 && b[p + len - 1] === END;
        }
        if (ok && b[i + 3 * len] === SYNC1) {
          this.protocol = "chords";
          this.channels = n;
          this.packetLen = len;
          this.buf = b.slice(i);
          this.chooseByteOrder();
          return;
        }
      }
    }
    // Text: several lines that parse as samples or a header.
    const str = new TextDecoder("latin1").decode(b);
    const lines = str.split("\n").slice(0, -1);
    const good = lines.filter((l) => parseSerialLine(l).kind !== "ignored").length;
    if (good >= 5 && good >= lines.length * 0.8) {
      this.protocol = "text";
      this.buf = new Uint8Array(0);
      this.pushText(new TextEncoder().encode(str), out);
    }
  }

  /**
   * EEG changes smoothly from sample to sample; the wrong byte order turns it
   * into jumps of hundreds of counts. Compare both readings on well-framed packets.
   */
  private chooseByteOrder(): void {
    const b = this.buf;
    const len = this.packetLen;
    let prevBe: number | null = null;
    let prevLe: number | null = null;
    let jumpBe = 0;
    let jumpLe = 0;
    let used = 0;
    for (let p = 0; p + len <= b.length && used < 64; p += len) {
      if (b[p] !== SYNC1 || b[p + 1] !== SYNC2 || b[p + len - 1] !== END) break;
      const hi = b[p + 3]!;
      const lo = b[p + 4]!;
      const be = (hi << 8) | lo;
      const le = (lo << 8) | hi;
      if (prevBe !== null && prevLe !== null) {
        jumpBe += Math.abs(be - prevBe);
        jumpLe += Math.abs(le - prevLe);
      }
      prevBe = be;
      prevLe = le;
      used += 1;
    }
    this.bigEndian = jumpBe <= jumpLe;
  }

  private readPackets(out: DecodedBatch): void {
    const b = this.buf;
    const len = this.packetLen;
    let p = 0;
    while (p + len <= b.length) {
      if (b[p] === SYNC1 && b[p + 1] === SYNC2 && b[p + len - 1] === END) {
        const hi = b[p + 3]!;
        const lo = b[p + 4]!;
        const v = this.bigEndian ? (hi << 8) | lo : (lo << 8) | hi;
        const counter = b[p + 2]!;
        if (this.lastCounter !== null) {
          const lost = (counter - this.lastCounter - 1 + 256) % 256;
          this.stats.lostPackets += lost;
          // Packets dropped on the way in: fill the gap so the time base (and so
          // every frequency) stays right. Long gaps are left alone.
          if (lost > 0 && lost <= MAX_FILL && this.lastValue !== null) {
            for (let k = 1; k <= lost; k++) out.samples.push(Math.round(this.lastValue + ((v - this.lastValue) * k) / (lost + 1)));
          }
        }
        this.lastCounter = counter;
        this.lastValue = v;
        out.samples.push(v);
        this.trackRange(v, out);
        this.stats.packets += 1;
        p += len;
      } else {
        // Lost framing (a dropped byte): resync on the next sync pair.
        const from = p;
        p += 1;
        while (p + 1 < b.length && !(b[p] === SYNC1 && b[p + 1] === SYNC2)) p += 1;
        this.stats.skippedBytes += p - from;
      }
    }
    this.buf = b.slice(p);
  }

  /** Chords packets carry no resolution, so infer it from the largest value seen. */
  private trackRange(v: number, out: DecodedBatch): void {
    if (this.bits !== null) return;
    this.seenMax = Math.max(this.seenMax, v);
    this.rangeSamples += 1;
    if (this.rangeSamples >= 200) {
      this.bits = [10, 12, 14, 16].find((bits) => this.seenMax < 2 ** bits) ?? 16;
      out.bits = this.bits;
    }
  }

  private pushText(chunk: Uint8Array, out: DecodedBatch): void {
    this.text += new TextDecoder("latin1").decode(chunk);
    const lines = this.text.split("\n");
    this.text = lines.pop() ?? "";
    for (const line of lines) {
      const p = parseSerialLine(line);
      if (p.kind === "sample") out.samples.push(p.counts);
      else if (p.kind === "header") {
        out.header = p.raw;
        if (p.bits) {
          this.bits = p.bits;
          out.bits = p.bits;
        }
      }
    }
  }
}

/** Rates boards actually use; a measured rate within 6% of one of these snaps to it. */
const STANDARD_RATES = [125, 250, 500, 1000, 2000];

/**
 * Converts any input rate to the 250 Hz the focus pipeline expects.
 *
 * The rate is measured over 8 s (after a 0.5 s warm-up): every one-second
 * count that matches a standard rate votes for it, so a pause after START or
 * USB bursts on Windows cannot skew the result. If the board's rate is
 * known (Chords on the UNO R4: 500 Hz), pass it in and nothing is measured. A whole multiple
 * of 250 Hz (Chords on the UNO R4 streams 500 Hz) is reduced by averaging
 * every k samples, which also acts as a light low-pass filter. Any other rate
 * is resampled by linear interpolation, so frequencies stay correct.
 */
export class RateAdapter {
  rateHz: number | null = null;
  /** The raw estimate before snapping, for the log. */
  measuredHz: number | null = null;
  factor = 1;
  /** "average" for whole multiples of the target, "resample" otherwise. */
  mode: "average" | "resample" = "average";
  private firstAt: number | null = null;
  private startedAt: number | null = null;
  private pending: number[] = [];
  private arrivals: Array<{ t: number; n: number }> = [];
  private acc = 0;
  private n = 0;
  // resampling state
  private step = 1;
  private pos = 0;
  private prev: number | null = null;

  constructor(
    private readonly emit: (counts: number) => void,
    private readonly target = SAMPLE_RATE_HZ,
    private readonly measureMs = 8000,
    /** Known input rate (e.g. 500 for Chords on the UNO R4); 0 = measure it. */
    fixedRateHz = 0,
  ) {
    if (fixedRateHz > 0) {
      this.measuredHz = fixedRateHz;
      this.applyRate(fixedRateHz);
    }
  }

  push(samples: readonly number[], nowMs: number): void {
    if (samples.length === 0) return;
    if (this.rateHz === null) {
      // Skip the first 0.5 s: the OS may hand over a backlog in one burst on connect.
      this.firstAt ??= nowMs;
      if (nowMs - this.firstAt < 500) return;
      this.startedAt ??= nowMs;
      this.pending.push(...samples);
      this.arrivals.push({ t: nowMs - this.startedAt, n: samples.length });
      if (nowMs - this.startedAt < this.measureMs) return;
      this.decideRate(nowMs - this.startedAt);
      const backlog = this.pending;
      this.pending = [];
      this.arrivals = [];
      for (const s of backlog) this.one(s);
      return;
    }
    for (const s of samples) this.one(s);
  }

  private decideRate(elapsedMs: number): void {
    // Each one-second count votes for the standard rate it matches (within 6%).
    // A pause after START or USB bursts on Windows produce seconds that match
    // nothing, while every steady second votes for the true rate.
    const SLICE = 1000;
    const slices = new Array<number>(Math.max(1, Math.floor(elapsedMs / SLICE))).fill(0);
    for (const a of this.arrivals) {
      const k = Math.min(slices.length - 1, Math.floor(a.t / SLICE));
      slices[k]! += a.n;
    }
    const votes = new Map<number, number>();
    for (const n of slices) {
      const r = STANDARD_RATES.find((rate) => Math.abs(n - rate) <= rate * 0.06);
      if (r) votes.set(r, (votes.get(r) ?? 0) + 1);
    }
    const best = [...votes.entries()].sort((a, b) => b[1] - a[1])[0];
    // No steady second at a standard rate: use the median of non-empty seconds.
    const busy = slices.filter((n) => n > 0).sort((a, b) => a - b);
    const median = busy.length ? busy[busy.length >> 1]! : (this.pending.length / elapsedMs) * 1000;
    this.measuredHz = Math.round(median);
    if (best && best[1] >= 2) {
      this.applyRate(best[0]);
      return;
    }
    const snapped = STANDARD_RATES.find((r) => Math.abs(median - r) <= r * 0.06);
    this.applyRate(snapped ?? this.measuredHz);
  }

  private applyRate(rate: number): void {
    this.rateHz = rate;
    const k = Math.round(this.rateHz / this.target);
    if (k >= 1 && k * this.target === this.rateHz) {
      this.mode = "average";
      this.factor = k;
    } else {
      this.mode = "resample";
      this.factor = 1;
      this.step = this.rateHz / this.target;
    }
  }

  private one(s: number): void {
    if (this.mode === "resample") {
      // Output sample j sits at input position j * step; interpolate between neighbours.
      if (this.prev === null) {
        this.prev = s;
        this.emit(s);
        this.pos = this.step;
        return;
      }
      while (this.pos <= 1) {
        this.emit(Math.round(this.prev + (s - this.prev) * this.pos));
        this.pos += this.step;
      }
      this.pos -= 1;
      this.prev = s;
      return;
    }
    this.acc += s;
    this.n += 1;
    if (this.n >= this.factor) {
      this.emit(Math.round(this.acc / this.n));
      this.acc = 0;
      this.n = 0;
    }
  }

  reset(): void {
    this.rateHz = null;
    this.measuredHz = null;
    this.arrivals = [];
    this.factor = 1;
    this.mode = "average";
    this.firstAt = null;
    this.startedAt = null;
    this.pending = [];
    this.acc = 0;
    this.n = 0;
    this.step = 1;
    this.pos = 0;
    this.prev = null;
  }
}
