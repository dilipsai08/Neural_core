import * as THREE from "three";
import { createSeededRng } from "@neural-core/shared";

/** Cosmetic randomness (sparks, bolt shapes). Gameplay never reads it. */
const fx = createSeededRng(0x5eed);
const rand = (a: number, b: number) => a + fx() * (b - a);

// ─── Lightning ─────────────────────────────────────────────────────────
const MAX_POINTS = 28;
const _dir = new THREE.Vector3();
const _toCam = new THREE.Vector3();
const _side = new THREE.Vector3();

/**
 * A lightning bolt drawn as a camera-facing ribbon (WebGL lines are 1px).
 * The path is re-jagged every few frames so it crackles while alive.
 */
class Bolt {
  readonly mesh: THREE.Mesh;
  private readonly geo: THREE.BufferGeometry;
  private readonly pos: Float32Array;
  private readonly path: THREE.Vector3[] = Array.from({ length: MAX_POINTS }, () => new THREE.Vector3());
  private count = 0;
  private from = new THREE.Vector3();
  private to = new THREE.Vector3();
  private life = 0;
  private maxLife = 0;
  private width = 0.1;
  private jag = 0.5;
  private rejag = 0;
  active = false;

  constructor(material: THREE.Material) {
    this.geo = new THREE.BufferGeometry();
    this.pos = new Float32Array(MAX_POINTS * 2 * 3);
    this.geo.setAttribute("position", new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    const idx: number[] = [];
    for (let i = 0; i < MAX_POINTS - 1; i++) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    this.geo.setIndex(idx);
    this.mesh = new THREE.Mesh(this.geo, material);
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    this.mesh.renderOrder = 10;
  }

  fire(from: THREE.Vector3, to: THREE.Vector3, opts: { life?: number; width?: number; jag?: number } = {}): void {
    this.from.copy(from);
    this.to.copy(to);
    this.maxLife = this.life = opts.life ?? 0.16;
    this.width = opts.width ?? 0.09;
    this.jag = opts.jag ?? 0.12;
    const len = from.distanceTo(to);
    this.count = Math.max(4, Math.min(MAX_POINTS, Math.round(len * 1.6)));
    this.rejag = 0;
    this.active = true;
    this.mesh.visible = true;
    this.shape();
  }

  private shape(): void {
    const n = this.count;
    const len = this.from.distanceTo(this.to);
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1);
      const p = this.path[i]!.lerpVectors(this.from, this.to, t);
      if (i > 0 && i < n - 1) {
        const env = Math.sin(t * Math.PI);
        const amp = this.jag * len * 0.08 * env;
        p.x += rand(-amp, amp);
        p.y += rand(-amp, amp);
        p.z += rand(-amp, amp);
      }
    }
  }

  update(dt: number, camera: THREE.Camera): void {
    if (!this.active) return;
    this.life -= dt;
    if (this.life <= 0) {
      this.active = false;
      this.mesh.visible = false;
      return;
    }
    this.rejag -= dt;
    if (this.rejag <= 0) {
      this.shape();
      this.rejag = 0.035;
    }
    const fade = this.life / this.maxLife;
    const w0 = this.width * (0.4 + 0.6 * fade);
    const camPos = camera.position;
    const dir = _dir;
    const toCam = _toCam;
    const side = _side;
    for (let i = 0; i < this.count; i++) {
      const p = this.path[i]!;
      const q = this.path[Math.min(this.count - 1, i + 1)]!;
      const o = this.path[Math.max(0, i - 1)]!;
      dir.subVectors(q, o).normalize();
      toCam.subVectors(camPos, p).normalize();
      // Taper toward the source: it starts next to the camera, where perspective would bloat it.
      const w = w0 * (0.3 + 0.7 * Math.min(1, (i / (this.count - 1)) * 3));
      side.crossVectors(dir, toCam).normalize().multiplyScalar(w);
      this.pos.set([p.x + side.x, p.y + side.y, p.z + side.z, p.x - side.x, p.y - side.y, p.z - side.z], i * 6);
    }
    // Collapse unused tail vertices onto the last point.
    const last = this.path[this.count - 1]!;
    for (let i = this.count; i < MAX_POINTS; i++) this.pos.set([last.x, last.y, last.z, last.x, last.y, last.z], i * 6);
    this.geo.attributes.position!.needsUpdate = true;
  }
}

export class LightningPool {
  readonly group = new THREE.Group();
  private readonly bolts: Bolt[] = [];
  private readonly core: THREE.MeshBasicMaterial;
  private readonly warm: THREE.MeshBasicMaterial;

  constructor(size = 28) {
    const mk = (color: number) =>
      new THREE.MeshBasicMaterial({
        color: new THREE.Color(color).multiplyScalar(2.2),
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
        toneMapped: false,
      });
    this.core = mk(0xbfefff);
    this.warm = mk(0xffd36b);
    for (let i = 0; i < size; i++) {
      const b = new Bolt(i % 7 === 6 ? this.warm : this.core);
      this.bolts.push(b);
      this.group.add(b.mesh);
    }
  }

  /** Main bolt plus a couple of short forks. */
  strike(from: THREE.Vector3, to: THREE.Vector3, opts: { width?: number; life?: number; forks?: number; jag?: number } = {}): void {
    this.take()?.fire(from, to, { width: opts.width ?? 0.1, life: opts.life ?? 0.18, jag: opts.jag ?? 0.12 });
    const forks = opts.forks ?? 2;
    const mid = new THREE.Vector3();
    for (let i = 0; i < forks; i++) {
      mid.lerpVectors(from, to, rand(0.35, 0.8));
      const end = mid.clone().add(new THREE.Vector3(rand(-1.2, 1.2), rand(-1.2, 0.6), rand(-1.2, 1.2)));
      this.take()?.fire(mid, end, { width: 0.035, life: (opts.life ?? 0.18) * 0.7, jag: 0.2 });
    }
  }

  private take(): Bolt | undefined {
    return this.bolts.find((b) => !b.active) ?? this.bolts[0];
  }

  update(dt: number, camera: THREE.Camera): void {
    for (const b of this.bolts) b.update(dt, camera);
  }
}

// ─── Sparks ────────────────────────────────────────────────────────────
const SPARK_VERT = /* glsl */ `
  attribute float aLife;
  attribute float aSize;
  varying float vLife;
  void main() {
    vLife = aLife;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSize * (300.0 / -mv.z) * clamp(aLife * 2.0, 0.0, 1.0);
    gl_Position = projectionMatrix * mv;
  }
`;
const SPARK_FRAG = /* glsl */ `
  uniform vec3 uHot;
  uniform vec3 uCool;
  varying float vLife;
  void main() {
    vec2 d = gl_PointCoord - 0.5;
    float r = length(d);
    if (r > 0.5) discard;
    float core = smoothstep(0.5, 0.0, r);
    vec3 col = mix(uCool, uHot, clamp(vLife * 1.6, 0.0, 1.0));
    gl_FragColor = vec4(col * 3.0, core * clamp(vLife * 2.5, 0.0, 1.0));
  }
`;

export class SparkPool {
  readonly points: THREE.Points;
  private readonly pos: Float32Array;
  private readonly vel: Float32Array;
  private readonly life: Float32Array;
  private readonly size: Float32Array;
  private next = 0;

  constructor(private readonly max = 700) {
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array(max * 3).fill(-999);
    this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.size = new Float32Array(max);
    g.setAttribute("position", new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute("aLife", new THREE.BufferAttribute(this.life, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute("aSize", new THREE.BufferAttribute(this.size, 1));
    this.points = new THREE.Points(
      g,
      new THREE.ShaderMaterial({
        vertexShader: SPARK_VERT,
        fragmentShader: SPARK_FRAG,
        uniforms: { uHot: { value: new THREE.Color(0xe8fbff) }, uCool: { value: new THREE.Color(0x3aa6ff) } },
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    this.points.frustumCulled = false;
  }

  burst(at: THREE.Vector3, count: number, speed = 6, up = 3): void {
    for (let i = 0; i < count; i++) {
      const k = this.next;
      this.next = (this.next + 1) % this.max;
      this.pos.set([at.x, at.y, at.z], k * 3);
      this.vel.set([rand(-speed, speed), rand(0, up + speed * 0.6), rand(-speed, speed)], k * 3);
      this.life[k] = rand(0.35, 0.9);
      this.size[k] = rand(0.04, 0.12);
    }
    this.points.geometry.attributes.aSize!.needsUpdate = true;
  }

  update(dt: number): void {
    const p = this.pos;
    const v = this.vel;
    for (let i = 0; i < this.max; i++) {
      if (this.life[i]! <= 0) continue;
      this.life[i] = this.life[i]! - dt;
      const j = i * 3;
      v[j + 1] = v[j + 1]! - 14 * dt;
      p[j] = p[j]! + v[j]! * dt;
      p[j + 1] = p[j + 1]! + v[j + 1]! * dt;
      p[j + 2] = p[j + 2]! + v[j + 2]! * dt;
      if (p[j + 1]! < 0.02) {
        p[j + 1] = 0.02;
        v[j + 1] = -v[j + 1]! * 0.35;
        v[j] = v[j]! * 0.6;
        v[j + 2] = v[j + 2]! * 0.6;
      }
      if (this.life[i]! <= 0) p[j + 1] = -999;
    }
    this.points.geometry.attributes.position!.needsUpdate = true;
    this.points.geometry.attributes.aLife!.needsUpdate = true;
  }
}

// ─── Debris physics ────────────────────────────────────────────────────
interface Body {
  mesh: THREE.Mesh;
  vel: THREE.Vector3;
  spin: THREE.Vector3;
  age: number;
  radius: number;
  resting: boolean;
}

/**
 * Rigid-ish body parts thrown when a zombie is fried: gravity, ground bounce
 * with restitution and friction, tumbling, then sinking away.
 */
export class DebrisSystem {
  readonly group = new THREE.Group();
  private bodies: Body[] = [];
  private readonly q = new THREE.Quaternion();
  private readonly e = new THREE.Euler();

  spawn(
    pieces: Array<{ geo: THREE.BufferGeometry; matrix: THREE.Matrix4 }>,
    material: THREE.Material,
    impulse: THREE.Vector3,
    origin: THREE.Vector3,
  ): void {
    for (const piece of pieces) {
      const mesh = new THREE.Mesh(piece.geo, material);
      piece.matrix.decompose(mesh.position, mesh.quaternion, mesh.scale);
      mesh.castShadow = true;
      if (!piece.geo.boundingSphere) piece.geo.computeBoundingSphere();
      const away = mesh.position.clone().sub(origin).setY(0).normalize();
      const vel = impulse.clone().add(away.multiplyScalar(rand(0.8, 2.6))).add(new THREE.Vector3(0, rand(2.5, 5.5), 0));
      this.bodies.push({
        mesh,
        vel,
        spin: new THREE.Vector3(rand(-9, 9), rand(-9, 9), rand(-9, 9)),
        age: 0,
        radius: (piece.geo.boundingSphere?.radius ?? 0.15) * mesh.scale.x * 0.6,
        resting: false,
      });
      this.group.add(mesh);
    }
    // Keep the scene light: never more than ~160 loose parts.
    while (this.bodies.length > 160) this.group.remove(this.bodies.shift()!.mesh);
  }

  update(dt: number): void {
    const keep: Body[] = [];
    for (const b of this.bodies) {
      b.age += dt;
      if (!b.resting) {
        b.vel.y -= 18 * dt;
        b.mesh.position.addScaledVector(b.vel, dt);
        this.e.set(b.spin.x * dt, b.spin.y * dt, b.spin.z * dt);
        this.q.setFromEuler(this.e);
        b.mesh.quaternion.premultiply(this.q);
        if (b.mesh.position.y < b.radius) {
          b.mesh.position.y = b.radius;
          if (Math.abs(b.vel.y) < 1.2) {
            b.vel.set(0, 0, 0);
            b.resting = true;
          } else {
            b.vel.y = -b.vel.y * 0.32;
            b.vel.x *= 0.55;
            b.vel.z *= 0.55;
            b.spin.multiplyScalar(0.5);
          }
        }
      }
      if (b.age > 2.6) b.mesh.position.y -= dt * 0.35;
      if (b.age > 4) {
        this.group.remove(b.mesh);
        continue;
      }
      keep.push(b);
    }
    this.bodies = keep;
  }

  clear(): void {
    for (const b of this.bodies) this.group.remove(b.mesh);
    this.bodies = [];
  }
}
