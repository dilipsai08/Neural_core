import type { FocusSource, FocusSample } from "@neural-core/shared";

export class FakeSource implements FocusSource {
  private active = false;
  private intervalTimer: ReturnType<typeof setInterval> | null = null;
  private listeners: Array<(s: FocusSample) => void> = [];
  private currentVal = 50;
  public targetValue = 50;

  constructor(private sampleRateHz = 250) {}

  async start(): Promise<void> {
    if (this.active) return;
    this.active = true;
    const intervalMs = 1000 / this.sampleRateHz;

    this.intervalTimer = setInterval(() => {
      const noise = (Math.random() - 0.5) * 8;
      this.currentVal += (this.targetValue - this.currentVal) * 0.05 + noise * 0.1;
      this.currentVal = Math.max(0, Math.min(100, this.currentVal));

      const sample: FocusSample = {
        t: Date.now(),
        uv: this.currentVal * 4.5 + (Math.random() - 0.5) * 20,
      };

      for (const fn of this.listeners) {
        fn(sample);
      }
    }, intervalMs);
  }

  async stop(): Promise<void> {
    this.active = false;
    if (this.intervalTimer) {
      clearInterval(this.intervalTimer);
      this.intervalTimer = null;
    }
  }

  onSample(cb: (s: FocusSample) => void): void {
    this.listeners.push(cb);
  }
}
