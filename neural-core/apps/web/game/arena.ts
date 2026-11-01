import * as THREE from "three";
import {
  ACTS,
  ARC_FORK_MULT,
  ARC_MIN_MULT,
  BOSS_SHIELD_MULT,
  BOSS_SPAWN_S,
  BREACH_PENALTY,
  COUNTDOWN_S,
  ChainTracker,
  DISTORTION_TAU_S,
  ENEMIES,
  MAX_PROGRESS_WOBBLE,
  ROUND_DURATION_S,
  SIGNAL_LOSS_PAUSE_MS,
  SIM_HZ,
  VERIFY_TIME_TOLERANCE_S,
  createSeededRng,
  distortionFor,
  fbm1,
  generateWave,
  nextChainStep,
  noise1,
  pointsForKill,
  type FocusFrame,
  type FocusPoint,
  type RunEvent,
  type SignalQuality,
  type SpawnEntry,
} from "@neural-core/shared";
import { audio } from "@/lib/audio";
import { DebrisSystem, LightningPool, SparkPool } from "./effects";
import { PostFX } from "./postfx";
import { GATE_X, LANES_Z, World } from "./world";
import { ZombieRig, zombieTemplate } from "./zombies";

export type ArenaPhase = "idle" | "countdown" | "playing" | "paused" | "finale" | "done";
export type PauseReason = "signal" | "quality" | "operator";

export interface ArenaHud {
  phase: ArenaPhase;
  countdown: number;
  timeLeft: number;
  act: string;
  actIndex: number;
  score: number;
  mult: number;
  sustainedS: number;
  nextStep: { atS: number; mult: number } | null;
  chainAlive: boolean;
  focus: number | null;
  distortion: number;
  quality: SignalQuality | null;
  artifact: FocusFrame["artifact"];
  breaches: number;
  kills: number;
  shots: number;
  hits: number;
  boss: { hp: number; max: number; shield: boolean } | null;
  pauseReason: PauseReason | null;
}

export interface ArenaResult {
  events: RunEvent[];
  focus: FocusPoint[];
  clientScore: number;
}

export interface ArenaCallbacks {
  onHud?: (hud: ArenaHud) => void;
  onRadio?: (text: string, from: string) => void;
  onChain?: (kind: "up" | "break", mult: number) => void;
  onFinish?: (result: ArenaResult) => void;
}

export interface OverlayClasses {
  crosshair: string;
  popup: string;
  popupMult: string;
  popupBad: string;
}

interface Enemy {
  spawn: SpawnEntry;
  rig: ZombieRig;
  hp: number;
  alive: boolean;
  x: number;
  z: number;
  y: number;
  px: number;
  pz: number;
  py: number;
  scale: number;
  box: THREE.Box3;
  removeAt: number | null;
  shield: THREE.Mesh | null;
  knock: number;
  arcT: number;
}

const RADIO: Array<{ at: number; from: string; text: string }> = [
  { at: 0.4, from: "Control", text: "Grid reboot started. Forty-five seconds. Keep them off the gate." },
  { at: 11, from: "Control", text: "Reboot at 25%. Sparkers on the line. They run fast, so lead your shots." },
  { at: 22, from: "Control", text: "Halfway. Brutes inbound, three hits each. Keep your mind quiet." },
  { at: BOSS_SPAWN_S - 0.5, from: "Control", text: "Something big is pulling the whole grid. The Conductor. Its shield drops when you hold a ×2 chain." },
  { at: ROUND_DURATION_S - 6, from: "Control", text: "Six seconds. Hold the line!" },
];

const SHIELD_VERT = /* glsl */ `
  varying vec3 vN;
  varying vec3 vV;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vN = normalize(normalMatrix * normal);
    vV = normalize(-mv.xyz);
    gl_Position = projectionMatrix * mv;
  }
`;
const SHIELD_FRAG = /* glsl */ `
  uniform float uTime;
  uniform float uHit;
  varying vec3 vN;
  varying vec3 vV;
  void main() {
    float f = pow(1.0 - abs(dot(vN, vV)), 2.5);
    float bands = 0.5 + 0.5 * sin(vN.y * 30.0 + uTime * 6.0);
    vec3 col = vec3(0.5, 0.89, 1.0) * (f * 1.6 + bands * f * 0.6 + uHit * 0.8);
    gl_FragColor = vec4(col, f * 0.85 + uHit * 0.3);
  }
`;

const _ray = new THREE.Raycaster();
const _ndc = new THREE.Vector2();
const _hit = new THREE.Vector3();
const _v = new THREE.Vector3();
const _plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
/** Cosmetic randomness only (shake, debris spin); gameplay uses seeded noise. */
const fxRng = createSeededRng(0xc0ffee);
const fxr = (a: number, b: number) => a + fxRng() * (b - a);

export class Arena {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly world: World;
  private readonly fx: PostFX;
  private readonly bolts = new LightningPool();
  private readonly sparks = new SparkPool();
  private readonly debris = new DebrisSystem();
  private readonly charMat = new THREE.MeshStandardMaterial({ color: 0x1d1f20, roughness: 0.95, flatShading: true, emissive: 0x0b2030 });
  private readonly shieldMat: THREE.ShaderMaterial;
  private readonly overlayEls: { crosshair: HTMLDivElement; popups: Array<{ el: HTMLDivElement; life: number; pos: THREE.Vector3 }> };

  private wave: SpawnEntry[] = [];
  private nextSpawn = 0;
  private enemies: Enemy[] = [];
  private laneStart: number[] = [-12, -14, -16];
  private readonly laneEnd = GATE_X - 0.7;
  /** Bolt origin: just off the bottom-right corner, like a held weapon. */
  private readonly emitter = new THREE.Vector3();

  private phase: ArenaPhase = "idle";
  private pauseReason: PauseReason | null = null;
  private countdown = 0;
  private lastBeep = 0;
  private t = 0; // run clock, seconds
  private wall = 0; // wall clock for visuals, seconds
  private acc = 0;
  private lastFrame = performance.now();
  private raf = 0;
  private hudTimer = 0;
  private finaleT = 0;
  private resumeHold = 0;

  private focus: number | null = null;
  private quality: SignalQuality | null = null;
  private artifact: FocusFrame["artifact"] = "none";
  private lastFocusWall = 0;
  private badSince: number | null = null;
  private distortion = 0.4;
  private readonly chain = new ChainTracker();
  private lastMult = 1;

  private score = 0;
  private kills = 0;
  private shots = 0;
  private hits = 0;
  private breaches = 0;
  private cooldown = 0;
  private events: RunEvent[] = [];
  private focusLog: FocusPoint[] = [];
  private radioIndex = 0;
  private toldArc = false;
  private toldBreach = false;
  private alarm = 0;
  private shake = 0;

  private pointer = new THREE.Vector2(0, 0);
  private pointerPx = { x: 0, y: 0 };
  private readonly attractRng = createSeededRng(99);
  private attractNextZap = 2;
  private attractSpawnT = 0;
  private attractId = 10_000;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly overlay: HTMLElement,
    private readonly mode: "play" | "attract",
    seed: number,
    private readonly classes: OverlayClasses,
    private readonly cb: ArenaCallbacks = {},
  ) {
    const lowPower = mode === "attract";
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, lowPower ? 1 : 1.25));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.3;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.camera = new THREE.PerspectiveCamera(42, 16 / 9, 0.1, 260);
    this.camera.position.set(0, 4.4, 16);
    this.camera.lookAt(0, 1.4, -2);

    this.scene.fog = new THREE.FogExp2(0x101a1c, 0.022);
    this.world = new World({ shadows: true, rainCount: lowPower ? 900 : 1400 });
    this.world.onThunder = () => {
      if (mode === "play") setTimeout(() => audio.thunder(), 400);
    };
    this.scene.add(this.world.group, this.bolts.group, this.sparks.points, this.debris.group);

    this.shieldMat = new THREE.ShaderMaterial({
      vertexShader: SHIELD_VERT,
      fragmentShader: SHIELD_FRAG,
      uniforms: { uTime: { value: 0 }, uHit: { value: 0 } },
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });

    this.fx = new PostFX(this.renderer, this.scene, this.camera, { trails: mode === "play" });

    const crosshair = document.createElement("div");
    crosshair.className = classes.crosshair;
    crosshair.innerHTML =
      '<svg viewBox="-50 -50 100 100"><circle class="ring" r="22"/><path class="ticks" d="M0 -40v12M0 28v12M-40 0h12M28 0h12"/><circle class="dot" r="2.2"/></svg>';
    if (mode === "attract") crosshair.style.display = "none";
    overlay.appendChild(crosshair);
    const popups = Array.from({ length: 24 }, () => {
      const el = document.createElement("div");
      el.className = classes.popup;
      el.style.opacity = "0";
      overlay.appendChild(el);
      return { el, life: 0, pos: new THREE.Vector3() };
    });
    this.overlayEls = { crosshair, popups };

    this.wave = mode === "play" ? generateWave(seed) : [];
    // Build every zombie template up front so the first spawn never hitches.
    for (const k of Object.keys(ENEMIES) as Array<keyof typeof ENEMIES>) zombieTemplate(k);

    this.resize();
    window.addEventListener("resize", this.resize);
    this.prewarm();
    this.raf = requestAnimationFrame(this.frame);
  }

  // ─── Public API ──────────────────────────────────────────────────────
  start(): void {
    if (this.mode !== "play" || this.phase !== "idle") return;
    this.phase = "countdown";
    this.countdown = COUNTDOWN_S;
    this.lastBeep = COUNTDOWN_S + 1;
    audio.startAmbient();
  }

  pushFocus(frame: FocusFrame): void {
    this.focus = frame.score;
    this.quality = frame.quality;
    this.artifact = frame.artifact;
    this.lastFocusWall = performance.now();
    if (frame.quality === "bad") this.badSince ??= performance.now();
    else this.badSince = null;

    if (this.phase !== "playing") return;
    const tMs = Math.round(this.t * 1000);
    this.focusLog.push({ tMs, score: frame.score, frameT: frame.t });
    const before = this.chain.state();
    const after = this.chain.push(tMs / 1000, frame.score);
    if (after.mult > this.lastMult) {
      audio.chainUp(after.mult);
      this.cb.onChain?.("up", after.mult);
      if (after.mult >= ARC_MIN_MULT && !this.toldArc) {
        this.toldArc = true;
        this.radio("Arc unlocked. Every kill now jumps to the nearest one.", "Control");
      }
    } else if (before.alive && !after.alive && this.lastMult > 1) {
      audio.chainBreak();
      this.cb.onChain?.("break", this.lastMult);
    }
    this.lastMult = after.mult;
  }

  setPointer(clientX: number, clientY: number): void {
    const rect = this.canvas.getBoundingClientRect();
    this.pointerPx.x = clientX - rect.left;
    this.pointerPx.y = clientY - rect.top;
    this.pointer.set((this.pointerPx.x / rect.width) * 2 - 1, -(this.pointerPx.y / rect.height) * 2 + 1);
  }

  nudgePointer(dx: number, dy: number): void {
    const rect = this.canvas.getBoundingClientRect();
    this.setPointer(
      rect.left + Math.max(0, Math.min(rect.width, this.pointerPx.x + dx)),
      rect.top + Math.max(0, Math.min(rect.height, this.pointerPx.y + dy)),
    );
  }

  pause(reason: PauseReason): void {
    if (this.phase !== "playing" && this.phase !== "countdown") return;
    this.phase = "paused";
    this.pauseReason = reason;
    this.emitHud();
  }

  resume(fromOperator = false): void {
    if (this.phase !== "paused") return;
    if (this.pauseReason === "operator" && !fromOperator) return;
    this.pauseReason = null;
    this.phase = "countdown";
    this.countdown = COUNTDOWN_S;
    this.lastBeep = COUNTDOWN_S + 1;
    // After a manual resume, give the headset 20 s before quality can pause again.
    this.resumeHold = fromOperator ? 20 : 0;
    this.lastFocusWall = performance.now();
    this.badSince = null;
  }

  abort(): ArenaResult {
    this.phase = "done";
    return this.result();
  }

  /** Screen positions of live enemies. Used by the end-to-end test to aim. */
  debugTargets(): Array<{ x: number; y: number; kind: string }> {
    const rect = this.canvas.getBoundingClientRect();
    return this.enemies
      .filter((e) => e.alive && e.x > -10)
      .map((e) => {
        _v.set(e.x, 1.1 * e.scale, e.z).project(this.camera);
        return { x: rect.left + (_v.x * 0.5 + 0.5) * rect.width, y: rect.top + (-_v.y * 0.5 + 0.5) * rect.height, kind: e.spawn.kind };
      })
      .filter((p) => p.x > 0 && p.x < rect.width);
  }

  dispose(): void {
    cancelAnimationFrame(this.raf);
    window.removeEventListener("resize", this.resize);
    for (const e of this.enemies) e.rig.dispose();
    this.fx.dispose();
    this.renderer.dispose();
    this.overlayEls.crosshair.remove();
    for (const p of this.overlayEls.popups) p.el.remove();
    if (this.mode === "play") audio.stopAmbient();
  }

  // ─── Loop ────────────────────────────────────────────────────────────
  private resize = (): void => {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.fx.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld();
    // Each lane starts just beyond the left edge of the screen.
    this.laneStart = LANES_Z.map((z) => {
      let lo = -60;
      let hi = 0;
      for (let i = 0; i < 24; i++) {
        const mid = (lo + hi) / 2;
        _v.set(mid, 1, z).project(this.camera);
        if (_v.x < -1.06) lo = mid;
        else hi = mid;
      }
      return lo - 0.8;
    });
    _v.set(1.02, -0.92, 0.5).unproject(this.camera);
    const dir = _v.sub(this.camera.position).normalize();
    this.emitter.copy(this.camera.position).addScaledVector(dir, 5);
  };

  private prewarm(): void {
    const tmp = (Object.keys(ENEMIES) as Array<keyof typeof ENEMIES>).map((k, i) => {
      const rig = new ZombieRig(k, 0.5);
      rig.root.position.set(-4 + i * 2, 0, -2);
      this.scene.add(rig.root);
      return rig;
    });
    this.renderer.compile(this.scene, this.camera);
    for (const r of tmp) {
      this.scene.remove(r.root);
      r.dispose();
    }
  }

  private frame = (now: number): void => {
    this.raf = requestAnimationFrame(this.frame);
    const dt = Math.min(0.1, (now - this.lastFrame) / 1000);
    this.lastFrame = now;
    this.wall += dt;
    const step = 1 / SIM_HZ;
    this.acc += dt;
    let steps = 0;
    while (this.acc >= step && steps < 6) {
      this.simulate(step);
      this.acc -= step;
      steps += 1;
    }
    if (steps === 6) this.acc = 0;
    this.render(dt, this.acc / step);
  };

  private simulate(dt: number): void {
    this.checkSignal();
    const targetD = this.mode === "attract" ? 0.45 + 0.4 * Math.sin(this.wall * 0.25) : this.focus === null ? 0.5 : distortionFor(this.focus);
    this.distortion += (targetD - this.distortion) * (1 - Math.exp(-dt / DISTORTION_TAU_S));
    this.cooldown = Math.max(0, this.cooldown - dt);
    this.alarm = Math.max(0, this.alarm - dt * 1.5);
    this.shake = Math.max(0, this.shake - dt * 3);
    this.resumeHold = Math.max(0, this.resumeHold - dt);

    if (this.phase === "countdown") {
      this.countdown -= dt;
      const whole = Math.ceil(this.countdown);
      if (whole < this.lastBeep && whole > 0) {
        audio.beep(false);
        this.lastBeep = whole;
      }
      if (this.countdown <= 0) {
        audio.beep(true);
        this.phase = "playing";
      }
    }

    if (this.mode === "attract") this.attractDirector(dt);

    if (this.phase === "playing") {
      this.t += dt;
      while (this.nextSpawn < this.wave.length && this.wave[this.nextSpawn]!.t <= this.t) {
        this.spawn(this.wave[this.nextSpawn]!);
        this.nextSpawn += 1;
      }
      while (this.radioIndex < RADIO.length && RADIO[this.radioIndex]!.at <= this.t) {
        const m = RADIO[this.radioIndex]!;
        this.radio(m.text, m.from);
        this.radioIndex += 1;
      }
      if (this.t >= ROUND_DURATION_S) this.beginFinale();
    }

    const moving = this.phase === "playing" || this.mode === "attract" || this.phase === "finale";
    const clock = this.mode === "attract" ? this.wall : this.t;
    for (const e of this.enemies) {
      e.px = e.x;
      e.pz = e.z;
      e.py = e.y;
      if (!e.alive || !moving) continue;
      this.moveEnemy(e, clock);
    }
    // Remove finished bodies.
    this.enemies = this.enemies.filter((e) => {
      if (e.removeAt !== null && this.wall >= e.removeAt) {
        this.scene.remove(e.rig.root);
        e.rig.dispose();
        return false;
      }
      return true;
    });

    if (this.phase === "finale") {
      this.finaleT += dt;
      if (this.finaleT > 2.6 && this.phase === "finale") {
        this.phase = "done";
        audio.stopAmbient();
        this.cb.onFinish?.(this.result());
      }
    }

    this.hudTimer -= dt;
    if (this.hudTimer <= 0 && this.mode === "play") {
      this.hudTimer = 0.1;
      this.emitHud();
    }
  }

  private checkSignal(): void {
    if (this.mode !== "play") return;
    const now = performance.now();
    const stale = now - this.lastFocusWall > SIGNAL_LOSS_PAUSE_MS;
    const bad = this.badSince !== null && now - this.badSince > 4000 && this.resumeHold <= 0;
    if (this.phase === "playing" || this.phase === "countdown") {
      if (stale) this.pause("signal");
      else if (bad) this.pause("quality");
    } else if (this.phase === "paused" && this.pauseReason !== "operator") {
      if (!stale && (this.badSince === null || this.pauseReason === "signal")) this.resume();
    }
  }

  private spawn(s: SpawnEntry): void {
    const rig = new ZombieRig(s.kind, (s.noiseSeed % 1000) / 1000);
    const scale = ENEMIES[s.kind].scale * (0.94 + ((s.noiseSeed >>> 10) % 100) / 900);
    rig.root.scale.setScalar(scale);
    const x = this.laneStart[s.lane] ?? -14;
    const z = LANES_Z[s.lane] ?? 0;
    rig.root.position.set(x, 0, z);
    this.scene.add(rig.root);
    let shield: THREE.Mesh | null = null;
    if (s.kind === "conductor") {
      shield = new THREE.Mesh(new THREE.SphereGeometry(1.25, 32, 20), this.shieldMat);
      shield.position.y = 1.15;
      rig.root.add(shield);
      audio.groan();
      this.shake = 0.6;
    } else if (s.id % 3 === 0) {
      audio.groan();
    }
    this.enemies.push({
      spawn: s,
      rig,
      hp: ENEMIES[s.kind].hp,
      alive: true,
      x,
      z,
      y: 0,
      px: x,
      pz: z,
      py: 0,
      scale,
      box: new THREE.Box3(),
      removeAt: null,
      shield,
      knock: 0,
      arcT: 0,
    });
  }

  /**
   * Steady left-to-right walk; focus decides how it looks. At good focus
   * (distortion 0) every enemy walks at its fixed speed on its lane. As focus
   * drops, distraction adds a bounded surge/stall (random-feeling speed),
   * depth wander, hard tremor, hops and glitch jumps that make them hard to
   * hit. All of it is smooth seeded noise, so it is the same for everyone.
   */
  private moveEnemy(e: Enemy, clock: number): void {
    const s = e.spawn;
    const d = this.distortion;
    const seed = s.noiseSeed;
    const base = (clock - s.t) / s.crossS;
    const p = base + d * MAX_PROGRESS_WOBBLE * fbm1(seed, clock * 1.4);
    const x0 = this.laneStart[s.lane] ?? -14;
    let x = x0 + (this.laneEnd - x0) * p;
    // Tremor grows faster than linearly, so drifting is a wobble and scattered is a shake.
    const shake = d * (0.35 + 0.6 * d);
    x += shake * noise1(seed + 13, clock * 11) + d * 0.9 * fbm1(seed + 17, clock * 2.6) - e.knock;
    let z = (LANES_Z[s.lane] ?? 0) + d * 2.4 * fbm1(seed + 7, clock * 1.6) + shake * 0.4 * noise1(seed + 19, clock * 10);
    const y = d * 0.35 * Math.max(0, noise1(seed + 21, clock * 7));
    let glitch = false;
    if (d > 0.3 && s.kind !== "conductor") {
      const g = noise1(seed + 29, clock * 3.2);
      if (g > 0.75 - 0.4 * d) {
        glitch = true;
        x += Math.sign(noise1(seed + 31, Math.floor(clock * 6))) * 2.2 * d;
        z += noise1(seed + 37, Math.floor(clock * 6)) * 1.4 * d;
      }
    }
    e.knock = Math.max(0, e.knock - 0.03);
    e.x = x;
    e.z = z;
    e.y = y;
    e.rig.root.visible = !glitch || Math.floor(this.wall * 24) % (d > 0.7 ? 2 : 3) !== 0;

    if (s.kind === "wraith") e.rig.setOpacity(0.1 + 0.85 * Math.max(0, 1 - d / 0.85));

    if (e.shield) {
      e.shield.visible = this.chain.state().mult < BOSS_SHIELD_MULT;
      // Arcs crawl between the coils in its skull.
      e.arcT -= 1 / SIM_HZ;
      if (e.arcT <= 0) {
        e.arcT = fxr(0.15, 0.5);
        const head = new THREE.Vector3(e.x, 2.2 * e.scale, e.z);
        const tip = head.clone().add(new THREE.Vector3(fxr(-0.4, 0.4), fxr(0.4, 0.8), fxr(-0.4, 0.4)));
        this.bolts.strike(head, tip, { width: 0.035, life: 0.09, forks: 0 });
      }
    }

    if (p >= 1) this.breach(e);
  }

  private breach(e: Enemy): void {
    e.alive = false;
    e.removeAt = this.wall + 0.05;
    _v.set(GATE_X - 0.2, 1.4, e.z);
    this.sparks.burst(_v, 40, 5, 2);
    this.bolts.strike(_v.clone().setY(3.4), _v, { width: 0.08, forks: 3 });
    this.world.alarm();
    if (this.mode !== "play") return;
    this.events.push({ tMs: Math.round(this.t * 1000), kind: "breach", enemyId: e.spawn.id, focus: this.focus ?? 0 });
    const end = e.spawn.t + e.spawn.crossS;
    // Same rule as the server: only crossings that end before the final whistle cost points.
    const penal = end < ROUND_DURATION_S - VERIFY_TIME_TOLERANCE_S;
    if (penal) {
      this.breaches += 1;
      this.score = Math.max(0, this.score - BREACH_PENALTY);
    }
    this.alarm = 1;
    this.shake = 0.5;
    audio.breach();
    this.popup(_v.set(GATE_X - 0.8, 2.6, e.z), penal ? `−${BREACH_PENALTY}  Breach` : "Breach", true);
    if (!this.toldBreach) {
      this.toldBreach = true;
      this.radio("They're through the fence! Every breach costs the grid. Stop them before the gate.", "Control");
    }
  }

  // ─── Shooting ────────────────────────────────────────────────────────
  fire(): void {
    if (this.mode !== "play" || this.phase !== "playing" || this.cooldown > 0) return;
    this.cooldown = 0.16;
    this.shots += 1;
    const tMs = Math.round(this.t * 1000);
    this.events.push({ tMs, kind: "shot", focus: this.focus ?? 0 });
    audio.zap();

    _ndc.copy(this.pointer);
    _ray.setFromCamera(_ndc, this.camera);
    let best: Enemy | null = null;
    let bestDist = Infinity;
    for (const e of this.enemies) {
      if (!e.alive || !e.rig.root.visible) continue;
      const w = 0.55 * e.scale;
      e.box.min.set(e.x - w, e.y, e.z - w * 1.1);
      e.box.max.set(e.x + w, e.y + 2.0 * e.scale, e.z + w * 1.1);
      const hit = _ray.ray.intersectBox(e.box, _hit);
      if (hit) {
        const dist = hit.distanceTo(this.camera.position);
        if (dist < bestDist) {
          bestDist = dist;
          best = e;
        }
      }
    }

    const target = new THREE.Vector3();
    if (best) {
      _ray.ray.intersectBox(best.box, target);
      this.bolts.strike(this.emitter, target, { width: 0.11, forks: 2 });
      this.world.flashImpact(target, 0.8);
      this.damage(best, "bolt", target);
    } else {
      if (!_ray.ray.intersectPlane(_plane, target) || target.distanceTo(this.camera.position) > 60) {
        target.copy(_ray.ray.direction).multiplyScalar(40).add(this.camera.position);
      }
      this.bolts.strike(this.emitter, target, { width: 0.07, forks: 1, jag: 0.18 });
      this.sparks.burst(target, 8, 3, 1);
      this.world.flashImpact(target, 0.35);
    }
  }

  private damage(e: Enemy, cause: "bolt" | "arc", at: THREE.Vector3): void {
    const tMs = Math.round(this.t * 1000);
    const focus = this.focus ?? 0;
    if (e.shield?.visible) {
      this.events.push({ tMs, kind: "deflect", enemyId: e.spawn.id, focus });
      this.shieldMat.uniforms.uHit!.value = 1;
      this.sparks.burst(at, 18, 4, 2);
      audio.deflect();
      this.popup(at, `Shielded · reach ×${BOSS_SHIELD_MULT}`, true);
      return;
    }
    this.events.push({ tMs, kind: "hit", enemyId: e.spawn.id, cause, focus });
    if (cause === "bolt") this.hits += 1;
    e.hp -= 1;
    e.rig.hitFlash(1);
    if (e.hp > 0) {
      e.knock = Math.min(0.6, e.knock + 0.25);
      this.sparks.burst(at, 14, 3, 2);
      audio.hit();
      return;
    }

    // Kill.
    e.alive = false;
    this.events.push({ tMs, kind: "kill", enemyId: e.spawn.id, cause, focus });
    const mult = this.chain.state().mult;
    const pts = pointsForKill(e.spawn.kind, mult);
    this.score += pts;
    this.kills += 1;
    this.popup(_v.set(e.x, 2.2 * e.scale, e.z), mult > 1 ? `+${pts}|×${mult}` : `+${pts}`, false);
    this.explode(e, at);
    if (e.spawn.kind === "conductor") {
      this.radio("The Conductor is down. The grid is ours. Finish them!", "Control");
      this.world.lightning();
      this.shake = 1;
    }

    // Arc chain: sustained focus turns a kill into a chain reaction.
    if (cause === "bolt" && mult >= ARC_MIN_MULT) {
      const jumps = mult >= ARC_FORK_MULT ? 2 : 1;
      const targets = this.enemies
        .filter((o) => o.alive && o !== e && Math.hypot(o.x - e.x, o.z - e.z) < 9.5)
        .sort((a, b) => Math.hypot(a.x - e.x, a.z - e.z) - Math.hypot(b.x - e.x, b.z - e.z))
        .slice(0, jumps);
      const from = new THREE.Vector3(e.x, 1.3 * e.scale, e.z);
      for (const o of targets) {
        const to = new THREE.Vector3(o.x, 1.2 * o.scale, o.z);
        this.bolts.strike(from, to, { width: 0.07, forks: 1, life: 0.22 });
        this.damage(o, "arc", to);
      }
    }
  }

  private explode(e: Enemy, at: THREE.Vector3): void {
    const big = e.spawn.kind === "brute" || e.spawn.kind === "conductor";
    const impulse = new THREE.Vector3(fxr(2.5, 3.5), 0, fxr(-1, 1));
    this.debris.spawn(e.rig.debrisPieces(), this.charMat, impulse, new THREE.Vector3(e.x, 1, e.z));
    this.sparks.burst(at, big ? 90 : 45, big ? 8 : 6, 3);
    this.world.flashImpact(at, big ? 1.6 : 1);
    e.removeAt = this.wall;
    audio.kill(big);
  }

  private beginFinale(): void {
    this.phase = "finale";
    this.finaleT = 0;
    this.radio("Grid restored. Substation 07 is holding. Good shift, Lineworker.", "Control");
    audio.surge();
    this.world.lightning();
    // The rebooted grid fries everything still standing (cosmetic, no points).
    this.enemies
      .filter((e) => e.alive)
      .forEach((e, i) => {
        setTimeout(() => {
          if (!e.alive) return;
          e.alive = false;
          const to = new THREE.Vector3(e.x, 1.2 * e.scale, e.z);
          this.bolts.strike(new THREE.Vector3(13, 7.5, -8.5), to, { width: 0.14, forks: 3, life: 0.3 });
          this.explode(e, to);
        }, 120 + i * 110);
      });
  }

  // ─── Attract mode (home screen) ──────────────────────────────────────
  private attractDirector(dt: number): void {
    if (this.attractId === 10_000) {
      // Open on a street that is already overrun.
      for (let i = 0; i < 9; i++) this.attractSpawn(-i * 1.9);
    }
    this.attractSpawnT -= dt;
    if (this.attractSpawnT <= 0 && this.enemies.filter((e) => e.alive).length < 14) {
      this.attractSpawnT = 0.6 + this.attractRng() * 0.9;
      this.attractSpawn(this.wall);
    }
    this.attractNextZap -= dt;
    if (this.attractNextZap <= 0) {
      this.attractNextZap = 2.2 + this.attractRng() * 2;
      const candidates = this.enemies.filter((e) => e.alive && e.x > 1.5);
      const e = candidates[Math.floor(this.attractRng() * candidates.length)];
      if (e) {
        const to = new THREE.Vector3(e.x, 1.2 * e.scale, e.z);
        this.bolts.strike(this.emitter, to, { width: 0.1, forks: 2 });
        e.alive = false;
        this.explode(e, to);
      }
    }
  }

  private attractSpawn(t: number): void {
    const kinds = ["shambler", "shambler", "shambler", "sparker", "brute", "wraith"] as const;
    const kind = kinds[Math.floor(this.attractRng() * kinds.length)]!;
    this.spawn({
      id: this.attractId,
      kind,
      t,
      lane: Math.floor(this.attractRng() * 3),
      crossS: ENEMIES[kind].crossS * 1.6,
      noiseSeed: this.attractId * 7919,
    });
    this.attractId += 1;
  }

  // ─── Render ──────────────────────────────────────────────────────────
  private render(dt: number, alpha: number): void {
    const animate = this.phase === "playing" || this.phase === "finale" || this.mode === "attract";
    for (const e of this.enemies) {
      const x = e.px + (e.x - e.px) * alpha;
      const z = e.pz + (e.z - e.pz) * alpha;
      const y = e.py + (e.y - e.py) * alpha;
      e.rig.root.position.set(x, y, z);
      if (e.alive && animate) {
        const speed = (e.x - e.px) * SIM_HZ;
        e.rig.animate(dt, Math.abs(speed), this.distortion);
      }
    }

    const locked = this.focus !== null && this.focus >= 80 ? 1 : 0;
    const level = this.mode === "attract" ? 0.6 + 0.3 * Math.sin(this.wall * 0.7) : (this.focus ?? 40) / 100;
    this.world.setCharge(level);
    this.world.update(dt, this.wall, this.distortion);
    this.bolts.update(dt, this.camera);
    this.sparks.update(dt);
    this.debris.update(dt);
    this.shieldMat.uniforms.uTime!.value = this.wall;
    this.shieldMat.uniforms.uHit!.value = Math.max(0, (this.shieldMat.uniforms.uHit!.value as number) - dt * 3);

    // Camera: slow breathing drift, distraction sway, impact shake.
    const d = this.distortion;
    const sway = this.mode === "attract" ? 1.2 : 0.25;
    const sx = Math.sin(this.wall * 0.31) * sway + (this.shake > 0 ? fxr(-0.5, 0.5) * this.shake * 0.35 : 0);
    const sy = Math.sin(this.wall * 0.23) * sway * 0.3 + (this.shake > 0 ? fxr(-0.5, 0.5) * this.shake * 0.25 : 0);
    this.camera.position.set(sx, 4.4 + sy, 16);
    this.camera.lookAt(sx * 0.4, 1.4, -2);
    this.camera.rotation.z += Math.sin(this.wall * 1.7) * d * d * 0.02;

    this.fx.update(this.wall, this.mode === "attract" ? 0.08 : d, locked, this.alarm);
    this.fx.render();
    this.drawOverlay(dt);
  }

  private drawOverlay(dt: number): void {
    const ch = this.overlayEls.crosshair;
    const d = this.distortion;
    ch.style.transform = `translate3d(${this.pointerPx.x}px, ${this.pointerPx.y}px, 0)`;
    ch.style.setProperty("--ring", String(1 + d * 1.3));
    ch.dataset.band = this.focus === null ? "none" : this.focus >= 80 ? "locked" : this.focus >= 60 ? "steady" : this.focus >= 35 ? "drifting" : "scattered";
    ch.dataset.ready = this.cooldown <= 0 && this.phase === "playing" ? "1" : "0";

    const rect = this.canvas.getBoundingClientRect();
    for (const p of this.overlayEls.popups) {
      if (p.life <= 0) continue;
      p.life -= dt;
      p.pos.y += dt * 0.9;
      _v.copy(p.pos).project(this.camera);
      const x = (_v.x * 0.5 + 0.5) * rect.width;
      const y = (-_v.y * 0.5 + 0.5) * rect.height;
      p.el.style.transform = `translate3d(${x}px, ${y}px, 0) translate(-50%, -50%)`;
      p.el.style.opacity = String(Math.min(1, p.life * 2.5));
    }
  }

  private popup(at: THREE.Vector3, text: string, bad: boolean): void {
    const slot = this.overlayEls.popups.reduce((a, b) => (b.life < a.life ? b : a));
    slot.pos.copy(at);
    slot.life = 1.1;
    const [main, mult] = text.split("|");
    slot.el.className = `${this.classes.popup} ${bad ? this.classes.popupBad : ""}`;
    slot.el.innerHTML = mult ? `${main}<b class="${this.classes.popupMult}">${mult}</b>` : main!;
  }

  private radio(text: string, from: string): void {
    audio.radio();
    this.cb.onRadio?.(text, from);
  }

  // ─── HUD + result ────────────────────────────────────────────────────
  private actIndex(): number {
    let i = 0;
    ACTS.forEach((a, k) => {
      if (this.t >= a.at) i = k;
    });
    return i;
  }

  private emitHud(): void {
    const chain = this.chain.state();
    const boss = this.enemies.find((e) => e.spawn.kind === "conductor" && e.alive);
    const idx = this.actIndex();
    this.cb.onHud?.({
      phase: this.phase,
      countdown: Math.max(0, this.countdown),
      timeLeft: Math.max(0, ROUND_DURATION_S - this.t),
      act: ACTS[idx]!.name,
      actIndex: idx,
      score: this.score,
      mult: chain.mult,
      sustainedS: chain.sustainedS,
      nextStep: nextChainStep(chain.sustainedS),
      chainAlive: chain.alive,
      focus: this.focus,
      distortion: this.distortion,
      quality: this.quality,
      artifact: this.artifact,
      breaches: this.breaches,
      kills: this.kills,
      shots: this.shots,
      hits: this.hits,
      boss: boss ? { hp: boss.hp, max: ENEMIES.conductor.hp, shield: Boolean(boss.shield?.visible) } : null,
      pauseReason: this.pauseReason,
    });
  }

  private result(): ArenaResult {
    return { events: this.events, focus: this.focusLog, clientScore: this.score };
  }
}
