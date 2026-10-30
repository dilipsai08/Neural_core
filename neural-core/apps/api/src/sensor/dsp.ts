/**
 * Pure signal-processing building blocks. No I/O, no timers: everything here
 * is deterministic and covered by unit tests.
 */

/** Direct-form I biquad (RBJ audio-EQ cookbook coefficients). */
export class Biquad {
  private x1 = 0;
  private x2 = 0;
  private y1 = 0;
  private y2 = 0;

  private constructor(
    private readonly b0: number,
    private readonly b1: number,
    private readonly b2: number,
    private readonly a1: number,
    private readonly a2: number,
  ) {}

  static lowpass(fs: number, f0: number, q = Math.SQRT1_2): Biquad {
    const w = (2 * Math.PI * f0) / fs;
    const alpha = Math.sin(w) / (2 * q);
    const cos = Math.cos(w);
    const a0 = 1 + alpha;
    return new Biquad((1 - cos) / 2 / a0, (1 - cos) / a0, (1 - cos) / 2 / a0, (-2 * cos) / a0, (1 - alpha) / a0);
  }

  static highpass(fs: number, f0: number, q = Math.SQRT1_2): Biquad {
    const w = (2 * Math.PI * f0) / fs;
    const alpha = Math.sin(w) / (2 * q);
    const cos = Math.cos(w);
    const a0 = 1 + alpha;
    return new Biquad((1 + cos) / 2 / a0, -(1 + cos) / a0, (1 + cos) / 2 / a0, (-2 * cos) / a0, (1 - alpha) / a0);
  }

  static notch(fs: number, f0: number, q = 30): Biquad {
    const w = (2 * Math.PI * f0) / fs;
    const alpha = Math.sin(w) / (2 * q);
    const cos = Math.cos(w);
    const a0 = 1 + alpha;
    return new Biquad(1 / a0, (-2 * cos) / a0, 1 / a0, (-2 * cos) / a0, (1 - alpha) / a0);
  }

  process(x: number): number {
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1;
    this.x1 = x;
    this.y2 = this.y1;
    this.y1 = y;
    return y;
  }

  reset(): void {
    this.x1 = this.x2 = this.y1 = this.y2 = 0;
  }
}

export class FilterChain {
  constructor(private readonly stages: Biquad[]) {}

  process(x: number): number {
    let v = x;
    for (const s of this.stages) v = s.process(v);
    return v;
  }

  reset(): void {
    for (const s of this.stages) s.reset();
  }
}

/** 0.5-45 Hz band-pass (2nd-order HP + 4th-order LP) followed by a mains notch. */
export function createEegFilter(fs: number, lowHz: number, highHz: number, notchHz: number): FilterChain {
  const stages = [Biquad.highpass(fs, lowHz), Biquad.lowpass(fs, highHz), Biquad.lowpass(fs, highHz)];
  if (notchHz > 0 && notchHz < fs / 2) stages.push(Biquad.notch(fs, notchHz));
  return new FilterChain(stages);
}

/** High-pass only: used to measure mains contamination before the notch. */
export function createDcBlocker(fs: number, lowHz: number): FilterChain {
  return new FilterChain([Biquad.highpass(fs, lowHz)]);
}

/** In-place iterative radix-2 FFT. Length must be a power of two. */
export function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j]!, re[i]!];
      [im[i], im[j]] = [im[j]!, im[i]!];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k;
        const b = a + len / 2;
        const tr = re[b]! * cr - im[b]! * ci;
        const ti = re[b]! * ci + im[b]! * cr;
        re[b] = re[a]! - tr;
        im[b] = im[a]! - ti;
        re[a] = re[a]! + tr;
        im[a] = im[a]! + ti;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = ncr;
      }
    }
  }
}

export function hann(n: number): Float64Array {
  const w = new Float64Array(n);
  for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1));
  return w;
}

/**
 * Welch power spectral density: Hann-windowed segments with 50% overlap,
 * zero-padded to nfft, averaged. Returns one-sided PSD of length nfft/2 + 1.
 */
export function welchPsd(signal: ArrayLike<number>, segLen: number, nfft: number): Float64Array {
  const win = hann(segLen);
  const winPow = win.reduce((a, v) => a + v * v, 0);
  const psd = new Float64Array(nfft / 2 + 1);
  const re = new Float64Array(nfft);
  const im = new Float64Array(nfft);
  const step = Math.max(1, Math.floor(segLen / 2));
  let segments = 0;

  for (let start = 0; start + segLen <= signal.length; start += step) {
    let mean = 0;
    for (let i = 0; i < segLen; i++) mean += signal[start + i]!;
    mean /= segLen;
    re.fill(0);
    im.fill(0);
    for (let i = 0; i < segLen; i++) re[i] = (signal[start + i]! - mean) * win[i]!;
    fft(re, im);
    for (let k = 0; k < psd.length; k++) psd[k] = psd[k]! + (re[k]! * re[k]! + im[k]! * im[k]!) / winPow;
    segments += 1;
  }
  if (segments > 0) for (let k = 0; k < psd.length; k++) psd[k] = psd[k]! / segments;
  return psd;
}

/** Sum of PSD bins whose centre frequency is in [lo, hi). */
export function bandPower(psd: Float64Array, fs: number, nfft: number, lo: number, hi: number): number {
  const df = fs / nfft;
  let sum = 0;
  for (let k = 0; k < psd.length; k++) {
    const f = k * df;
    if (f >= lo && f < hi) sum += psd[k]!;
  }
  return sum;
}

export function mean(values: ArrayLike<number>): number {
  let s = 0;
  for (let i = 0; i < values.length; i++) s += values[i]!;
  return values.length ? s / values.length : 0;
}

export function std(values: ArrayLike<number>): number {
  const m = mean(values);
  let s = 0;
  for (let i = 0; i < values.length; i++) s += (values[i]! - m) ** 2;
  return values.length ? Math.sqrt(s / values.length) : 0;
}

/** Median absolute deviation scaled to a std-dev estimate (robust to blinks). */
export function robustStd(values: ArrayLike<number>): number {
  const arr = Array.from(values);
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const med = sorted[sorted.length >> 1]!;
  const dev = arr.map((v) => Math.abs(v - med)).sort((a, b) => a - b);
  return dev[dev.length >> 1]! * 1.4826;
}

/** Fixed-capacity ring buffer of numbers with ordered snapshot. */
export class Ring {
  private readonly buf: Float64Array;
  private head = 0;
  private filled = 0;

  constructor(readonly capacity: number) {
    this.buf = new Float64Array(capacity);
  }

  push(v: number): void {
    this.buf[this.head] = v;
    this.head = (this.head + 1) % this.capacity;
    if (this.filled < this.capacity) this.filled += 1;
  }

  get length(): number {
    return this.filled;
  }

  get full(): boolean {
    return this.filled === this.capacity;
  }

  /** Oldest → newest. */
  snapshot(last = this.filled): Float64Array {
    const n = Math.min(last, this.filled);
    const out = new Float64Array(n);
    const start = (this.head - n + this.capacity) % this.capacity;
    for (let i = 0; i < n; i++) out[i] = this.buf[(start + i) % this.capacity]!;
    return out;
  }

  clear(): void {
    this.head = 0;
    this.filled = 0;
  }
}
