import { ADC_BITS_DEFAULT, type FocusSource, type RawSample } from "@neural-core/shared";

/**
 * Samples pushed over WebSocket by a bridge running next to the hardware:
 * the node bridge script or the browser's Web Serial bridge. DSP still runs
 * here, so the server stays the single source of truth for the score.
 */
export class BridgeSource implements FocusSource {
  readonly kind = "bridge" as const;
  adcMax = 2 ** ADC_BITS_DEFAULT - 1;
  lastPushAt = 0;

  private listeners: Array<(s: RawSample) => void> = [];
  private bitsListeners: Array<(adcMax: number) => void> = [];

  async start(): Promise<void> {}
  async stop(): Promise<void> {}

  onSample(cb: (s: RawSample) => void): void {
    this.listeners.push(cb);
  }

  onAdcMax(cb: (adcMax: number) => void): void {
    this.bitsListeners.push(cb);
  }

  ingest(counts: readonly number[], bits: number): void {
    const max = 2 ** bits - 1;
    if (max !== this.adcMax) {
      this.adcMax = max;
      for (const cb of this.bitsListeners) cb(max);
    }
    const t = Date.now();
    this.lastPushAt = t;
    for (const c of counts) {
      const s: RawSample = { t, counts: c };
      for (const cb of this.listeners) cb(s);
    }
  }
}
