import { readFileSync } from "node:fs";
import { SAMPLE_RATE_HZ, type FocusSource, type RawSample } from "@neural-core/shared";
import { parseSerialLine } from "./serial-protocol.js";

/**
 * Loops a recorded session (one ADC count per line, as written by the station
 * recorder or captured from the Arduino serial monitor) in real time.
 */
export class ReplaySource implements FocusSource {
  readonly kind = "replay" as const;
  adcMax = 16383;

  private readonly data: number[];
  private timer: ReturnType<typeof setInterval> | null = null;
  private listeners: Array<(s: RawSample) => void> = [];
  private i = 0;

  constructor(file: string, private readonly fs = SAMPLE_RATE_HZ) {
    this.data = [];
    for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
      const cell = line.includes(",") ? line.split(",").pop()! : line;
      const p = parseSerialLine(cell);
      if (p.kind === "sample") this.data.push(p.counts);
      if (p.kind === "header" && p.bits) this.adcMax = 2 ** p.bits - 1;
    }
    if (this.data.length < fs * 3) throw new Error(`replay file ${file} has fewer than 3 s of samples`);
  }

  async start(): Promise<void> {
    if (this.timer) return;
    let last = Date.now();
    this.timer = setInterval(() => {
      const now = Date.now();
      const due = Math.min(Math.round(((now - last) / 1000) * this.fs), this.fs);
      if (due <= 0) return;
      last += (due / this.fs) * 1000;
      for (let k = 0; k < due; k++) {
        const s: RawSample = { t: now, counts: this.data[this.i]! };
        this.i = (this.i + 1) % this.data.length;
        for (const cb of this.listeners) cb(s);
      }
    }, 20);
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  onSample(cb: (s: RawSample) => void): void {
    this.listeners.push(cb);
  }
}
