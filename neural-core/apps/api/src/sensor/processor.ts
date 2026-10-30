import {
  BAND_ALPHA,
  BAND_BETA,
  BAND_HIGH,
  BAND_THETA,
  BANDPASS_HIGH_HZ,
  BANDPASS_LOW_HZ,
  BLINK_HOLD_MS,
  BLINK_SIGMA,
  FFT_SIZE,
  FOCUS_EMA_ALPHA,
  QUALITY_FLAT_COUNTS,
  QUALITY_MAINS_RATIO_FAIR,
  QUALITY_RAIL_SHARE_BAD,
  TENSION_PENALTY,
  TENSION_RATIO,
  WELCH_SEGMENT_S,
  WINDOW_HOP_S,
  WINDOW_SIZE_S,
  clamp,
  mapFocusScore,
  type ArtifactType,
  type BandPowers,
  type Calibration,
  type SignalQuality,
} from "@neural-core/shared";
import { Ring, bandPower, createDcBlocker, createEegFilter, despike, robustStd, std, welchPsd } from "./dsp.js";

export interface Analysis {
  /** Sample-clock time of the end of this window (ms since processor start). */
  tMs: number;
  bands: BandPowers;
  /** Engagement index beta / (alpha + theta). */
  index: number;
  artifact: ArtifactType;
  /** 0-1 share of 30-45 Hz power; drives the tension penalty. */
  highRatio: number;
  quality: SignalQuality;
  mainsRatio: number;
  railShare: number;
  /** Most recent hop of filtered samples, decimated for display. */
  wave: number[];
}

export interface ProcessorOptions {
  fs: number;
  adcMax: number;
  mainsHz: number;
}

/** 14-bit reference scale for the flat-signal threshold. */
const FLAT_REF_FULL_SCALE = 16383;
const WAVE_DECIMATE = 5; // 250 Hz → 50 Hz for display

/**
 * Streaming EEG analyser: raw ADC counts in, one Analysis per hop out.
 * Window 2 s, hop 0.25 s, Welch PSD with 1 s Hann segments.
 */
export class FocusProcessor {
  private readonly win: number;
  private readonly hop: number;
  private readonly seg: number;
  private readonly filtered: Ring;
  private readonly dcBlocked: Ring;
  private readonly raw: Ring;
  private readonly eeg;
  private readonly dc;
  private sinceHop = 0;
  private samples = 0;
  private settle: number;
  /** Last few centred samples and the signal's typical spread, for spike removal. */
  private recentIn: number[] = [];
  private spikeScale = 0;
  private spikesRemoved = 0;

  constructor(private opts: ProcessorOptions) {
    this.win = Math.round(WINDOW_SIZE_S * opts.fs);
    this.hop = Math.round(WINDOW_HOP_S * opts.fs);
    this.seg = Math.round(WELCH_SEGMENT_S * opts.fs);
    this.filtered = new Ring(this.win);
    this.dcBlocked = new Ring(this.win);
    this.raw = new Ring(this.win);
    this.eeg = createEegFilter(opts.fs, BANDPASS_LOW_HZ, BANDPASS_HIGH_HZ, opts.mainsHz);
    this.dc = createDcBlocker(opts.fs, BANDPASS_LOW_HZ);
    // Let the 0.5 Hz high-pass settle before trusting the output.
    this.settle = Math.round(opts.fs * 1.5);
  }

  setAdcMax(adcMax: number): void {
    this.opts = { ...this.opts, adcMax };
  }

  reset(): void {
    this.recentIn = [];
    this.spikeScale = 0;
    this.filtered.clear();
    this.dcBlocked.clear();
    this.raw.clear();
    this.eeg.reset();
    this.dc.reset();
    this.sinceHop = 0;
    this.samples = 0;
    this.settle = Math.round(this.opts.fs * 1.5);
  }

  /** Feed one raw ADC sample. Returns an analysis when a hop completes. */
  push(counts: number): Analysis | null {
    this.raw.push(counts);
    const centred = this.removeSpike(counts - this.opts.adcMax / 2);
    this.filtered.push(this.eeg.process(centred));
    this.dcBlocked.push(this.dc.process(centred));
    this.samples += 1;
    if (this.settle > 0) {
      this.settle -= 1;
      return null;
    }
    this.sinceHop += 1;
    if (this.sinceHop < this.hop || !this.filtered.full) return null;
    this.sinceHop = 0;
    return this.analyse();
  }

  /**
   * Electrical spikes are 1-2 samples wide; EEG and even blinks are far wider.
   * A sample that jumps more than 8 typical spreads away from the median of the
   * last five is replaced by that median before it reaches the filters, where
   * it would otherwise ring into the beta band.
   */
  private removeSpike(v: number): number {
    const r = this.recentIn;
    r.push(v);
    if (r.length > 5) r.shift();
    if (r.length < 5 || !(this.spikeScale > 0)) return v;
    const med = [...r].sort((a, b) => a - b)[2]!;
    if (Math.abs(v - med) <= 8 * this.spikeScale) return v;
    this.spikesRemoved += 1;
    r[r.length - 1] = med;
    return med;
  }

  private analyse(): Analysis {
    // Typical sample-to-sample spread of the recent (high-passed) signal, for spike removal.
    const hp = this.dcBlocked.snapshot();
    const diffs = new Float64Array(hp.length - 1);
    for (let i = 1; i < hp.length; i++) diffs[i - 1] = hp[i]! - hp[i - 1]!;
    this.spikeScale = robustStd(diffs) + robustStd(hp) * 0.25;

    const { fs, adcMax, mainsHz } = this.opts;
    const x = this.filtered.snapshot();
    // Spectrum of the de-spiked signal; blink detection below still sees the raw peaks.
    const psd = welchPsd(despike(x), this.seg, FFT_SIZE);
    const bands: BandPowers = {
      theta: bandPower(psd, fs, FFT_SIZE, BAND_THETA[0], BAND_THETA[1]),
      alpha: bandPower(psd, fs, FFT_SIZE, BAND_ALPHA[0], BAND_ALPHA[1]),
      beta: bandPower(psd, fs, FFT_SIZE, BAND_BETA[0], BAND_BETA[1]),
      high: bandPower(psd, fs, FFT_SIZE, BAND_HIGH[0], BAND_HIGH[1]),
    };
    const index = bands.beta / Math.max(1e-9, bands.alpha + bands.theta);
    const total = bands.theta + bands.alpha + bands.beta + bands.high;
    const highRatio = total > 0 ? bands.high / total : 0;

    // Blink: a large, short excursion in the latest hop relative to the window.
    const baseline = robustStd(x);
    let peak = 0;
    for (let i = x.length - this.hop; i < x.length; i++) peak = Math.max(peak, Math.abs(x[i]!));
    const blink = baseline > 0 && peak > BLINK_SIGMA * baseline;
    const artifact: ArtifactType = blink ? "blink" : highRatio > TENSION_RATIO ? "tension" : "none";

    // Quality: rails, flat line, mains contamination.
    const raw = this.raw.snapshot();
    const railLo = adcMax * 0.01;
    const railHi = adcMax * 0.99;
    let railed = 0;
    for (const v of raw) if (v <= railLo || v >= railHi) railed += 1;
    const railShare = raw.length ? railed / raw.length : 1;
    const flat = std(raw) * (FLAT_REF_FULL_SCALE / adcMax) < QUALITY_FLAT_COUNTS;

    const dcPsd = welchPsd(this.dcBlocked.snapshot(), this.seg, FFT_SIZE);
    const mains = mainsHz > 0 ? bandPower(dcPsd, fs, FFT_SIZE, mainsHz - 1.5, mainsHz + 1.5) : 0;
    const eegBand = bandPower(dcPsd, fs, FFT_SIZE, 1, 45);
    const mainsRatio = eegBand > 0 ? mains / eegBand : 0;

    // Clipping or a dead line make the EEG unusable. Mains hum alone is removed by
    // the notch, so it only warns ("fair") instead of blocking play.
    let quality: SignalQuality = "good";
    if (railShare > QUALITY_RAIL_SHARE_BAD || flat) quality = "bad";
    else if (mainsRatio > QUALITY_MAINS_RATIO_FAIR || railShare > 0) quality = "fair";

    const wave: number[] = [];
    for (let i = x.length - this.hop; i < x.length; i += WAVE_DECIMATE) wave.push(round(x[i]!));

    return {
      tMs: Math.round((this.samples / fs) * 1000),
      bands,
      index,
      artifact,
      highRatio,
      quality,
      mainsRatio: round(mainsRatio),
      railShare: round(railShare),
      wave,
    };
  }
}

function round(v: number): number {
  return Math.round(v * 1000) / 1000;
}

export interface ScoreFrame {
  score: number;
  raw: number;
}

/**
 * Turns analyses into a 0-100 focus score: calibration mapping, tension
 * penalty, blink hold and EMA smoothing.
 */
/** Median of the last few indices (≈1.25 s) before mapping: one noisy window cannot swing the score. */
const INDEX_MEDIAN_N = 5;

export class FocusScorer {
  private ema: number | null = null;
  private lastRaw = 50;
  private blinkSince: number | null = null;
  private recent: number[] = [];

  constructor(private calibration: Calibration) {}

  setCalibration(c: Calibration): void {
    this.calibration = c;
  }

  reset(): void {
    this.ema = null;
    this.lastRaw = 50;
    this.blinkSince = null;
    this.recent = [];
  }

  next(a: Analysis): ScoreFrame {
    if (a.artifact === "blink") {
      this.blinkSince ??= a.tMs;
      if (a.tMs - this.blinkSince <= BLINK_HOLD_MS && this.ema !== null) {
        return { score: round1(this.ema), raw: round1(this.lastRaw) };
      }
    } else {
      this.blinkSince = null;
    }

    // Clipping or a dead line: hold the last score rather than follow garbage.
    if (a.quality === "bad" && this.ema !== null) {
      return { score: round1(this.ema), raw: round1(this.lastRaw) };
    }

    this.recent.push(a.index);
    if (this.recent.length > INDEX_MEDIAN_N) this.recent.shift();
    const sorted = [...this.recent].sort((p, q) => p - q);
    const index = sorted[sorted.length >> 1]!;
    let raw = mapFocusScore(index, this.calibration.low, this.calibration.high);
    if (a.artifact === "tension") {
      const over = clamp((a.highRatio - TENSION_RATIO) / TENSION_RATIO, 0, 1);
      raw = clamp(raw - TENSION_PENALTY * (0.4 + 0.6 * over), 0, 100);
    }
    this.lastRaw = raw;
    this.ema = this.ema === null ? raw : this.ema + FOCUS_EMA_ALPHA * (raw - this.ema);
    return { score: round1(this.ema), raw: round1(raw) };
  }
}

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}
