/**
 * Procedural Web Audio Sound Engine
 * Features:
 * - 80s Analog Synthesizer Arpeggiator (Stranger Things inspired dark synthwave)
 * - Dynamic Heartbeat & Sub-bass Drone
 * - Visceral Monster Roars & Screeches
 * - Weapon SFX: Pistol, Shotgun, Pulse Rifle, Plasma Cannon
 * - Auto-reload mechanical audio cues & pickup chimes
 */

export class SoundManager {
  private ctx: AudioContext | null = null;
  private isMuted = false;
  private isPlayingBgm = false;
  private bgmInterval: any = null;
  private droneOsc: OscillatorNode | null = null;
  private droneGain: GainNode | null = null;
  private masterGain: GainNode | null = null;

  // Arpeggio notes (C minor / eerie mystery progression)
  private arpeggioNotes = [
    65.41,  // C2
    77.78,  // Eb2
    98.00,  // G2
    116.54, // Bb2
    130.81, // C3
    116.54, // Bb2
    98.00,  // G2
    77.78,  // Eb2
  ];
  private currentStep = 0;
  private bpm = 120;

  constructor() {
    // AudioContext will be initialized on user interaction (browser policy)
  }

  public init() {
    if (this.ctx) return;
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      this.ctx = new AudioCtx();
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.setValueAtTime(0.7, this.ctx.currentTime);
      this.masterGain.connect(this.ctx.destination);
    } catch (e) {
      console.warn("Web Audio API not supported", e);
    }
  }

  public resume() {
    if (this.ctx && this.ctx.state === "suspended") {
      this.ctx.resume();
    }
  }

  public startTenseMusic() {
    this.init();
    if (!this.ctx || this.isPlayingBgm) return;
    this.resume();
    this.isPlayingBgm = true;

    // Start deep dark drone
    try {
      this.droneOsc = this.ctx.createOscillator();
      this.droneGain = this.ctx.createGain();
      this.droneOsc.type = "sawtooth";
      this.droneOsc.frequency.setValueAtTime(32.7, this.ctx.currentTime); // C1 sub-bass

      const filter = this.ctx.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.setValueAtTime(140, this.ctx.currentTime);

      this.droneGain.gain.setValueAtTime(0.2, this.ctx.currentTime);
      this.droneOsc.connect(filter);
      filter.connect(this.droneGain);
      this.droneGain.connect(this.masterGain!);
      this.droneOsc.start();
    } catch (e) {}

    // Arpeggio sequencer loop
    const stepDuration = (60 / this.bpm) / 2; // 16th/8th notes
    this.bgmInterval = setInterval(() => {
      if (!this.isPlayingBgm || !this.ctx || this.isMuted) return;
      this.playSynthNote(this.arpeggioNotes[this.currentStep % this.arpeggioNotes.length]!);
      this.currentStep++;
    }, stepDuration * 1000);
  }

  private playSynthNote(freq: number) {
    if (!this.ctx || !this.masterGain) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    const filter = this.ctx.createBiquadFilter();

    // Vintage Stranger Things analog brass/saw sound
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(freq, this.ctx.currentTime);

    filter.type = "lowpass";
    filter.frequency.setValueAtTime(400, this.ctx.currentTime);
    filter.frequency.exponentialRampToValueAtTime(1200, this.ctx.currentTime + 0.05);
    filter.frequency.exponentialRampToValueAtTime(200, this.ctx.currentTime + 0.35);

    const now = this.ctx.currentTime;
    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(0.18, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain);

    osc.start(now);
    osc.stop(now + 0.38);
  }

  public setTensionIntensity(intensity: number) {
    // Intensity between 0 and 1 (increases as zombies get closer or boss spawns)
    if (!this.ctx || !this.droneGain) return;
    const clamped = Math.max(0, Math.min(1, intensity));
    this.droneGain.gain.setTargetAtTime(0.15 + clamped * 0.25, this.ctx.currentTime, 0.2);
  }

  public playGunshot(type: "pistol" | "shotgun" | "rifle" | "plasma") {
    if (!this.ctx || !this.masterGain || this.isMuted) return;
    const now = this.ctx.currentTime;

    if (type === "plasma") {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = "sawtooth";
      osc.frequency.setValueAtTime(800, now);
      osc.frequency.exponentialRampToValueAtTime(80, now + 0.25);

      gain.gain.setValueAtTime(0.3, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.28);

      osc.connect(gain);
      gain.connect(this.masterGain);
      osc.start(now);
      osc.stop(now + 0.3);
      return;
    }

    // Explosive noise burst for ballistic weapons
    const bufferSize = this.ctx.sampleRate * (type === "shotgun" ? 0.35 : 0.18);
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }

    const noise = this.ctx.createBufferSource();
    noise.buffer = buffer;

    const filter = this.ctx.createBiquadFilter();
    filter.type = type === "shotgun" ? "lowpass" : "bandpass";
    filter.frequency.setValueAtTime(type === "shotgun" ? 800 : 1800, now);

    const gain = this.ctx.createGain();
    const vol = type === "shotgun" ? 0.45 : type === "rifle" ? 0.25 : 0.3;
    gain.gain.setValueAtTime(vol, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + (type === "shotgun" ? 0.32 : 0.16));

    // Punch oscillator for bottom end thump
    const subOsc = this.ctx.createOscillator();
    const subGain = this.ctx.createGain();
    subOsc.type = "sine";
    subOsc.frequency.setValueAtTime(type === "shotgun" ? 120 : 180, now);
    subOsc.frequency.exponentialRampToValueAtTime(30, now + 0.12);
    subGain.gain.setValueAtTime(0.35, now);
    subGain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);

    subOsc.connect(subGain);
    subGain.connect(this.masterGain);
    subOsc.start(now);
    subOsc.stop(now + 0.15);

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain);
    noise.start(now);
  }

  public playReloadSound() {
    if (!this.ctx || !this.masterGain || this.isMuted) return;
    const now = this.ctx.currentTime;

    // Metallic reload slide click
    const osc1 = this.ctx.createOscillator();
    const gain1 = this.ctx.createGain();
    osc1.type = "triangle";
    osc1.frequency.setValueAtTime(1400, now);
    gain1.gain.setValueAtTime(0.12, now);
    gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.06);

    const osc2 = this.ctx.createOscillator();
    const gain2 = this.ctx.createGain();
    osc2.type = "sine";
    osc2.frequency.setValueAtTime(800, now + 0.1);
    gain2.gain.setValueAtTime(0.15, now + 0.1);
    gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.18);

    osc1.connect(gain1);
    gain1.connect(this.masterGain);
    osc2.connect(gain2);
    gain2.connect(this.masterGain);

    osc1.start(now);
    osc1.stop(now + 0.08);
    osc2.start(now + 0.1);
    osc2.stop(now + 0.2);
  }

  public playMonsterHit() {
    if (!this.ctx || !this.masterGain || this.isMuted) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(260, now);
    osc.frequency.exponentialRampToValueAtTime(70, now + 0.15);

    gain.gain.setValueAtTime(0.2, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);

    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.16);
  }

  public playMonsterRoar(isBoss = false) {
    if (!this.ctx || !this.masterGain || this.isMuted) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = "sawtooth";
    const startFreq = isBoss ? 90 : 180;
    osc.frequency.setValueAtTime(startFreq, now);
    osc.frequency.linearRampToValueAtTime(startFreq + 60, now + 0.2);
    osc.frequency.exponentialRampToValueAtTime(40, now + (isBoss ? 0.9 : 0.45));

    const filter = this.ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.setValueAtTime(isBoss ? 280 : 450, now);

    gain.gain.setValueAtTime(0.25, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + (isBoss ? 0.9 : 0.45));

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + (isBoss ? 0.95 : 0.5));
  }

  public playPickupSound() {
    if (!this.ctx || !this.masterGain || this.isMuted) return;
    const now = this.ctx.currentTime;
    const notes = [440, 554.37, 659.25, 880]; // Major chord power-up
    notes.forEach((freq, idx) => {
      const osc = this.ctx!.createOscillator();
      const gain = this.ctx!.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(freq, now + idx * 0.06);

      gain.gain.setValueAtTime(0.15, now + idx * 0.06);
      gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.06 + 0.2);

      osc.connect(gain);
      gain.connect(this.masterGain!);
      osc.start(now + idx * 0.06);
      osc.stop(now + idx * 0.06 + 0.22);
    });
  }

  public playPlayerHurt() {
    if (!this.ctx || !this.masterGain || this.isMuted) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(90, now);
    osc.frequency.linearRampToValueAtTime(45, now + 0.2);

    gain.gain.setValueAtTime(0.4, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);

    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.28);
  }

  public stopAll() {
    this.isPlayingBgm = false;
    if (this.bgmInterval) {
      clearInterval(this.bgmInterval);
      this.bgmInterval = null;
    }
    if (this.droneOsc) {
      try {
        this.droneOsc.stop();
      } catch (e) {}
      this.droneOsc = null;
    }
  }

  public toggleMute(): boolean {
    this.isMuted = !this.isMuted;
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setValueAtTime(this.isMuted ? 0 : 0.7, this.ctx.currentTime);
    }
    return this.isMuted;
  }
}
