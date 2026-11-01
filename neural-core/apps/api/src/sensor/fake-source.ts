import { SAMPLE_RATE_HZ, clamp, createSeededRng, type FocusSource, type RawSample } from "@neural-core/shared";

const ADC_MAX = 16383;

/**
 * Synthetic forehead EEG. It produces raw ADC counts, so the full DSP chain
 * runs exactly as it does with the real BioAmp EXG Pill; the game cannot tell
 * the difference.
 *
 * Focus (0-1) shifts power from theta/alpha to beta. Occasional blinks and jaw
 * tension bursts exercise the artifact handling.
 */
export class FakeSource implements FocusSource {
  readonly kind = "fake" as const;
  readonly adcMax = ADC_MAX;

  /** Operator slider (0-100), or null to wander like a real player. */
  target: number | null = null;
  /** Forced level during calibration so the measured range is meaningful. */
  calibrationHint: "relax" | "focus" | null = null;

  private timer: ReturnType<typeof setInterval> | null = null;
  private listeners: Array<(s: RawSample) => void> = [];
  private readonly rng = createSeededRng(Date.now() & 0xffff);
  private n = 0;
  private level = 0.5;
  private wanderGoal = 0.6;
  private blinkLeft = 0;
  private tensionLeft = 0;
  private pink = [0, 0, 0];
  private phase = { theta: 0, alpha: 0, beta1: 0, beta2: 0 };

  constructor(private readonly fs = SAMPLE_RATE_HZ) {}

  async start(): Promise<void> {
    if (this.timer) return;
    let last = Date.now();
    this.timer = setInterval(() => {
      const now = Date.now();
      const due = Math.min(Math.round(((now - last) / 1000) * this.fs), this.fs);
      if (due <= 0) return;
      last += (due / this.fs) * 1000;
      for (let i = 0; i < due; i++) this.emit(now);
    }, 20);
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  onSample(cb: (s: RawSample) => void): void {
    this.listeners.push(cb);
  }

  private desiredLevel(): number {
    if (this.calibrationHint === "relax") return 0;
    if (this.calibrationHint === "focus") return 1;
    if (this.target !== null) return this.target / 100;
    // Wander: drift between goals, like attention does.
    if (this.n % (this.fs * 3) === 0) {
      const r = this.rng();
      this.wanderGoal = r < 0.2 ? 0.2 + this.rng() * 0.2 : 0.55 + this.rng() * 0.4;
    }
    return this.wanderGoal;
  }

  private emit(now: number): void {
    const dt = 1 / this.fs;
    this.level += (this.desiredLevel() - this.level) * (this.calibrationHint ? 0.02 : 0.004);
    const f = clamp(this.level, 0, 1);

    // Choose beta so the engagement index beta/(alpha+theta) moves roughly
    // linearly with focus; that makes the operator slider feel 1:1.
    const theta = 11 - 3 * f;
    const alpha = 13 - 4 * f;
    const index = 0.12 + 1.2 * f;
    const amp = { theta, alpha, beta: Math.sqrt((index * (theta * theta + alpha * alpha)) / 0.61) };
    const tau = 2 * Math.PI;
    this.phase.theta += tau * 6 * dt;
    this.phase.alpha += tau * (10 + 0.4 * Math.sin(this.n / 400)) * dt;
    this.phase.beta1 += tau * 18 * dt;
    this.phase.beta2 += tau * 24 * dt;

    // Cheap pink-ish noise.
    const w = this.rng() * 2 - 1;
    this.pink[0] = 0.99 * this.pink[0]! + w * 0.1;
    this.pink[1] = 0.9 * this.pink[1]! + w * 0.3;
    this.pink[2] = w * 0.6;
    const noise = (this.pink[0]! + this.pink[1]! + this.pink[2]!) * 3.5;

    let v =
      amp.theta * Math.sin(this.phase.theta) +
      amp.alpha * Math.sin(this.phase.alpha) +
      amp.beta * (0.6 * Math.sin(this.phase.beta1) + 0.5 * Math.sin(this.phase.beta2 + 1)) +
      noise +
      2.5 * Math.sin(tau * 50 * this.n * dt);

    if (this.calibrationHint === null) {
      if (this.blinkLeft === 0 && this.rng() < 0.15 * dt) this.blinkLeft = Math.round(0.25 * this.fs);
      if (this.tensionLeft === 0 && this.target === null && this.rng() < 0.03 * dt) {
        this.tensionLeft = Math.round(0.8 * this.fs);
      }
    }
    if (this.blinkLeft > 0) {
      const p = 1 - this.blinkLeft / (0.25 * this.fs);
      v += 220 * Math.sin(Math.PI * p);
      this.blinkLeft -= 1;
    }
    if (this.tensionLeft > 0) {
      v += 45 * Math.sin(tau * 38 * this.n * dt) + (this.rng() * 2 - 1) * 40;
      this.tensionLeft -= 1;
    }

    this.n += 1;
    const counts = Math.round(clamp(ADC_MAX / 2 + v * 1.6, 0, ADC_MAX));
    const sample: RawSample = { t: now, counts };
    for (const cb of this.listeners) cb(sample);
  }
}
