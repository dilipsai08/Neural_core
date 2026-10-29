"use client";

import { safeGet, safeSet } from "./config";

/**
 * Procedural sound: every effect is synthesised with WebAudio, so the game
 * ships no audio files and works offline. The ambient hum doubles as
 * biofeedback: it detunes and wobbles as focus drops and resolves into a
 * clean tone when the player is locked in.
 */
class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private ambient: {
    hum: OscillatorNode[];
    humGain: GainNode;
    lowpass: BiquadFilterNode;
    wobble: GainNode;
    clean: GainNode;
    rain: GainNode;
  } | null = null;
  muted = safeGet("nc.muted") === "1";

  private ensure(): AudioContext | null {
    if (typeof window === "undefined") return null;
    if (!this.ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return null;
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.8;
      const comp = this.ctx.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.ratio.value = 4;
      this.master.connect(comp).connect(this.ctx.destination);
      const len = this.ctx.sampleRate * 2;
      this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const data = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === "suspended") void this.ctx.resume();
    return this.ctx;
  }

  /** Call from a user gesture (click) so the browser allows audio. */
  unlock(): void {
    this.ensure();
  }

  setMuted(m: boolean): void {
    this.muted = m;
    safeSet("nc.muted", m ? "1" : "0");
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 0.8, this.ctx.currentTime, 0.05);
  }

  private noiseSource(): AudioBufferSourceNode | null {
    if (!this.ctx || !this.noise) return null;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    src.loopStart = Math.random();
    return src;
  }

  private env(gain: GainNode, t: number, peak: number, attack: number, decay: number): void {
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(peak, t + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  }

  // ─── Ambient bed ─────────────────────────────────────────────────────
  startAmbient(): void {
    const ctx = this.ensure();
    if (!ctx || this.ambient || !this.master) return;
    const humGain = ctx.createGain();
    humGain.gain.value = 0;
    humGain.gain.setTargetAtTime(0.05, ctx.currentTime, 1.5);
    const lowpass = ctx.createBiquadFilter();
    lowpass.type = "lowpass";
    lowpass.frequency.value = 260;
    lowpass.Q.value = 3;
    const wobble = ctx.createGain();
    wobble.gain.value = 0;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 5.3;
    lfo.connect(wobble);

    const hum = [50, 100.4, 150.2].map((f, i) => {
      const o = ctx.createOscillator();
      o.type = i === 0 ? "sawtooth" : "square";
      o.frequency.value = f;
      wobble.connect(o.detune);
      const g = ctx.createGain();
      g.gain.value = [0.6, 0.18, 0.08][i]!;
      o.connect(g).connect(lowpass);
      o.start();
      return o;
    });
    lowpass.connect(humGain).connect(this.master);
    lfo.start();

    const clean = ctx.createGain();
    clean.gain.value = 0;
    for (const f of [220, 330.5]) {
      const o = ctx.createOscillator();
      o.type = "sine";
      o.frequency.value = f;
      o.connect(clean);
      o.start();
    }
    clean.connect(this.master);

    const rain = ctx.createGain();
    rain.gain.value = 0;
    rain.gain.setTargetAtTime(0.018, ctx.currentTime, 2);
    const rainSrc = this.noiseSource()!;
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 3800;
    bp.Q.value = 0.5;
    rainSrc.connect(bp).connect(rain).connect(this.master);
    rainSrc.start();

    this.ambient = { hum, humGain, lowpass, wobble, clean, rain };
  }

  /** d: 0 (locked in) … 0.9 (scattered). */
  setDistortion(d: number): void {
    if (!this.ctx || !this.ambient) return;
    const t = this.ctx.currentTime;
    this.ambient.wobble.gain.setTargetAtTime(d * 70, t, 0.4);
    this.ambient.lowpass.frequency.setTargetAtTime(220 + d * 900, t, 0.4);
    this.ambient.clean.gain.setTargetAtTime(Math.max(0, 0.3 - d) * 0.06, t, 0.6);
  }

  stopAmbient(): void {
    if (!this.ctx || !this.ambient) return;
    const a = this.ambient;
    const t = this.ctx.currentTime;
    a.humGain.gain.setTargetAtTime(0, t, 0.3);
    a.clean.gain.setTargetAtTime(0, t, 0.3);
    a.rain.gain.setTargetAtTime(0, t, 0.3);
    setTimeout(() => a.hum.forEach((o) => o.stop()), 1500);
    this.ambient = null;
  }

  // ─── One-shots ───────────────────────────────────────────────────────
  zap(): void {
    const ctx = this.ensure();
    if (!ctx || !this.master) return;
    const t = ctx.currentTime;
    const n = this.noiseSource()!;
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.Q.value = 2.5;
    bp.frequency.setValueAtTime(5200, t);
    bp.frequency.exponentialRampToValueAtTime(700, t + 0.16);
    const g = ctx.createGain();
    this.env(g, t, 0.5, 0.003, 0.17);
    n.connect(bp).connect(g).connect(this.master);
    n.start(t);
    n.stop(t + 0.22);

    const o = ctx.createOscillator();
    o.type = "square";
    o.frequency.setValueAtTime(1900, t);
    o.frequency.exponentialRampToValueAtTime(160, t + 0.09);
    const og = ctx.createGain();
    this.env(og, t, 0.08, 0.002, 0.09);
    o.connect(og).connect(this.master);
    o.start(t);
    o.stop(t + 0.12);
  }

  kill(big = false): void {
    const ctx = this.ensure();
    if (!ctx || !this.master) return;
    const t = ctx.currentTime;
    for (let i = 0; i < (big ? 7 : 4); i++) {
      const n = this.noiseSource()!;
      const hp = ctx.createBiquadFilter();
      hp.type = "highpass";
      hp.frequency.value = 2000 + Math.random() * 3000;
      const g = ctx.createGain();
      const at = t + i * 0.025 + Math.random() * 0.02;
      this.env(g, at, 0.22, 0.001, 0.035);
      n.connect(hp).connect(g).connect(this.master);
      n.start(at);
      n.stop(at + 0.06);
    }
    const o = ctx.createOscillator();
    o.type = "sine";
    o.frequency.setValueAtTime(big ? 120 : 95, t);
    o.frequency.exponentialRampToValueAtTime(32, t + (big ? 0.6 : 0.25));
    const og = ctx.createGain();
    this.env(og, t, big ? 0.7 : 0.4, 0.004, big ? 0.6 : 0.25);
    o.connect(og).connect(this.master);
    o.start(t);
    o.stop(t + 0.7);
  }

  hit(): void {
    const ctx = this.ensure();
    if (!ctx || !this.master) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = "triangle";
    o.frequency.setValueAtTime(320, t);
    o.frequency.exponentialRampToValueAtTime(140, t + 0.08);
    const g = ctx.createGain();
    this.env(g, t, 0.25, 0.002, 0.09);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + 0.12);
  }

  deflect(): void {
    const ctx = this.ensure();
    if (!ctx || !this.master) return;
    const t = ctx.currentTime;
    for (const f of [1840, 2717, 3301]) {
      const o = ctx.createOscillator();
      o.type = "sine";
      o.frequency.value = f;
      const g = ctx.createGain();
      this.env(g, t, 0.07, 0.002, 0.35);
      o.connect(g).connect(this.master);
      o.start(t);
      o.stop(t + 0.4);
    }
  }

  groan(): void {
    const ctx = this.ensure();
    if (!ctx || !this.master) return;
    const t = ctx.currentTime;
    const base = 70 + Math.random() * 40;
    const o = ctx.createOscillator();
    o.type = "sawtooth";
    o.frequency.setValueAtTime(base, t);
    o.frequency.linearRampToValueAtTime(base * 0.8, t + 0.9);
    const f1 = ctx.createBiquadFilter();
    f1.type = "bandpass";
    f1.frequency.setValueAtTime(450, t);
    f1.frequency.linearRampToValueAtTime(320, t + 0.9);
    f1.Q.value = 6;
    const g = ctx.createGain();
    this.env(g, t, 0.12, 0.15, 0.8);
    o.connect(f1).connect(g).connect(this.master);
    o.start(t);
    o.stop(t + 1.05);
  }

  chainUp(level: number): void {
    const ctx = this.ensure();
    if (!ctx || !this.master) return;
    const t = ctx.currentTime;
    const root = 392 * Math.pow(2, Math.min(level, 6) / 12);
    [1, 1.25, 1.5, 2].forEach((m, i) => {
      const o = ctx.createOscillator();
      o.type = "triangle";
      o.frequency.value = root * m;
      const g = ctx.createGain();
      const at = t + i * 0.06;
      this.env(g, at, 0.12, 0.005, 0.32);
      o.connect(g).connect(this.master!);
      o.start(at);
      o.stop(at + 0.4);
    });
  }

  chainBreak(): void {
    const ctx = this.ensure();
    if (!ctx || !this.master) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = "sawtooth";
    o.frequency.setValueAtTime(330, t);
    o.frequency.exponentialRampToValueAtTime(90, t + 0.35);
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 900;
    const g = ctx.createGain();
    this.env(g, t, 0.12, 0.005, 0.35);
    o.connect(lp).connect(g).connect(this.master);
    o.start(t);
    o.stop(t + 0.4);
  }

  breach(): void {
    const ctx = this.ensure();
    if (!ctx || !this.master) return;
    const t = ctx.currentTime;
    [0, 0.18].forEach((d, i) => {
      const o = ctx.createOscillator();
      o.type = "square";
      o.frequency.value = i ? 185 : 233;
      const lp = ctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = 1400;
      const g = ctx.createGain();
      this.env(g, t + d, 0.14, 0.01, 0.16);
      o.connect(lp).connect(g).connect(this.master!);
      o.start(t + d);
      o.stop(t + d + 0.2);
    });
  }

  radio(): void {
    const ctx = this.ensure();
    if (!ctx || !this.master) return;
    const t = ctx.currentTime;
    const n = this.noiseSource()!;
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 1800;
    bp.Q.value = 1.2;
    const g = ctx.createGain();
    this.env(g, t, 0.16, 0.005, 0.14);
    n.connect(bp).connect(g).connect(this.master);
    n.start(t);
    n.stop(t + 0.2);
  }

  thunder(): void {
    const ctx = this.ensure();
    if (!ctx || !this.master) return;
    const t = ctx.currentTime;
    const n = this.noiseSource()!;
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.setValueAtTime(600, t);
    lp.frequency.exponentialRampToValueAtTime(80, t + 2.5);
    const g = ctx.createGain();
    this.env(g, t, 0.35, 0.05, 2.6);
    n.connect(lp).connect(g).connect(this.master);
    n.start(t);
    n.stop(t + 2.8);
  }

  beep(high = false): void {
    const ctx = this.ensure();
    if (!ctx || !this.master) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = "square";
    o.frequency.value = high ? 1320 : 660;
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 2500;
    const g = ctx.createGain();
    this.env(g, t, 0.12, 0.003, high ? 0.4 : 0.14);
    o.connect(lp).connect(g).connect(this.master);
    o.start(t);
    o.stop(t + 0.5);
  }

  click(): void {
    const ctx = this.ensure();
    if (!ctx || !this.master) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = "square";
    o.frequency.value = 2400;
    const g = ctx.createGain();
    this.env(g, t, 0.05, 0.001, 0.02);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + 0.04);
  }

  surge(): void {
    const ctx = this.ensure();
    if (!ctx || !this.master) return;
    const t = ctx.currentTime;
    const n = this.noiseSource()!;
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.Q.value = 1.5;
    bp.frequency.setValueAtTime(200, t);
    bp.frequency.exponentialRampToValueAtTime(6000, t + 1.2);
    const g = ctx.createGain();
    this.env(g, t, 0.45, 0.6, 1.2);
    n.connect(bp).connect(g).connect(this.master);
    n.start(t);
    n.stop(t + 2);
    this.kill(true);
  }
}

export const audio = new AudioEngine();
