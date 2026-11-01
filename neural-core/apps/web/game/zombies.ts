import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { EnemyKind } from "@neural-core/shared";

/**
 * Procedural zombies, one skinned mesh per body (rigid skinning: every vertex
 * follows exactly one bone). One draw call for the body plus one for the
 * glowing parts, instead of a dozen separate limbs.
 */

type Role = "skin" | "shirt" | "pants" | "dark" | "accent";

interface KindLook {
  colors: Record<Role, number>;
  glow: number;
  width: number; // torso width multiplier
  lean: number;
  armPose: "reach" | "swing" | "dangle";
  gait: "shamble" | "run" | "stomp" | "glide" | "march";
  stepHz: number;
  crown?: boolean;
  vest?: boolean;
}

export const LOOKS: Record<EnemyKind, KindLook> = {
  shambler: {
    colors: { skin: 0x8b9a7c, shirt: 0x2c3a4a, pants: 0x3b3a36, dark: 0x1c1b19, accent: 0x5a4a3a },
    glow: 0x8fe8ff,
    width: 1,
    lean: 0.32,
    armPose: "reach",
    gait: "shamble",
    stepHz: 1.5,
  },
  sparker: {
    colors: { skin: 0x9aa284, shirt: 0x6e6a2e, pants: 0x2e3238, dark: 0x16181a, accent: 0xb59a2a },
    glow: 0xffd34d,
    width: 0.85,
    lean: 0.55,
    armPose: "swing",
    gait: "run",
    stepHz: 2.9,
    vest: true,
  },
  brute: {
    colors: { skin: 0x7d8a70, shirt: 0x3d4a3a, pants: 0x2b3440, dark: 0x141414, accent: 0x6b5236 },
    glow: 0xff8a3d,
    width: 1.45,
    lean: 0.18,
    armPose: "swing",
    gait: "stomp",
    stepHz: 1.1,
  },
  wraith: {
    colors: { skin: 0xb8c8d0, shirt: 0x6d7c88, pants: 0x55616b, dark: 0x2a3036, accent: 0x9fb2bf },
    glow: 0xe6f7ff,
    width: 0.8,
    lean: 0.1,
    armPose: "dangle",
    gait: "glide",
    stepHz: 0.8,
  },
  conductor: {
    colors: { skin: 0x6f7a66, shirt: 0x1d2228, pants: 0x1a1d22, dark: 0x0e0f10, accent: 0xb87333 },
    glow: 0x8fe8ff,
    width: 1.25,
    lean: 0.12,
    armPose: "swing",
    gait: "march",
    stepHz: 0.9,
    crown: true,
  },
};

const BONES = [
  "hips",
  "spine",
  "chest",
  "head",
  "shoulderL",
  "elbowL",
  "shoulderR",
  "elbowR",
  "thighL",
  "kneeL",
  "thighR",
  "kneeR",
] as const;
type BoneName = (typeof BONES)[number];

/** Bind-pose bone offsets relative to the parent (metres, facing +Z). */
function bindSkeleton(width: number): Record<BoneName, { parent: BoneName | null; pos: [number, number, number] }> {
  const sx = 0.25 * width;
  return {
    hips: { parent: null, pos: [0, 0.95, 0] },
    spine: { parent: "hips", pos: [0, 0.1, 0] },
    chest: { parent: "spine", pos: [0, 0.28, 0] },
    head: { parent: "chest", pos: [0, 0.34, 0.02] },
    shoulderL: { parent: "chest", pos: [sx, 0.25, 0] },
    elbowL: { parent: "shoulderL", pos: [0, -0.3, 0] },
    shoulderR: { parent: "chest", pos: [-sx, 0.25, 0] },
    elbowR: { parent: "shoulderR", pos: [0, -0.3, 0] },
    thighL: { parent: "hips", pos: [0.11 * width, -0.02, 0] },
    kneeL: { parent: "thighL", pos: [0, -0.44, 0] },
    thighR: { parent: "hips", pos: [-0.11 * width, -0.02, 0] },
    kneeR: { parent: "thighR", pos: [0, -0.44, 0] },
  };
}

interface Part {
  bone: BoneName;
  geo: THREE.BufferGeometry; // in bone-local space
  role: Role | "glow";
}

function box(w: number, h: number, d: number, x = 0, y = 0, z = 0, rx = 0): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  if (rx) g.rotateX(rx);
  g.translate(x, y, z);
  return g.toNonIndexed();
}

function partsFor(kind: EnemyKind): Part[] {
  const L = LOOKS[kind];
  const w = L.width;
  const p: Part[] = [
    { bone: "hips", geo: box(0.36 * w, 0.2, 0.22), role: "pants" },
    { bone: "spine", geo: box(0.38 * w, 0.3, 0.22, 0, 0.12, 0), role: "shirt" },
    { bone: "chest", geo: box(0.46 * w, 0.36, 0.26, 0, 0.12, 0), role: "shirt" },
    // ragged shirt hem
    { bone: "spine", geo: box(0.4 * w, 0.06, 0.24, 0.03, -0.04, 0.01, 0.15), role: "shirt" },
    { bone: "chest", geo: box(0.12, 0.08, 0.1, 0, 0.32, 0.01), role: "skin" }, // neck
    // head: low-poly skull with brow ridge, slack jaw and lank hair
    {
      bone: "head",
      geo: (() => {
        const g = new THREE.IcosahedronGeometry(0.15, 1);
        g.scale(0.95, 1.12, 1.05);
        g.translate(0, 0.12, 0.01);
        return g.toNonIndexed();
      })(),
      role: "skin",
    },
    { bone: "head", geo: box(0.2, 0.04, 0.06, 0, 0.17, 0.12), role: "skin" },
    { bone: "head", geo: box(0.14, 0.05, 0.1, 0, 0.0, 0.08, 0.35), role: "skin" },
    { bone: "head", geo: box(0.26, 0.1, 0.24, 0, 0.24, -0.03), role: "dark" },
    // arms with hands
    { bone: "shoulderL", geo: box(0.11, 0.3, 0.11, 0, -0.15, 0), role: "shirt" },
    { bone: "elbowL", geo: box(0.09, 0.28, 0.09, 0, -0.14, 0), role: "skin" },
    { bone: "elbowL", geo: box(0.08, 0.12, 0.05, 0, -0.32, 0.01), role: "skin" },
    { bone: "shoulderR", geo: box(0.11, 0.3, 0.11, 0, -0.15, 0), role: "shirt" },
    { bone: "elbowR", geo: box(0.09, 0.28, 0.09, 0, -0.14, 0), role: "skin" },
    { bone: "elbowR", geo: box(0.08, 0.12, 0.05, 0, -0.32, 0.01), role: "skin" },
    // legs with boots
    { bone: "thighL", geo: box(0.15, 0.44, 0.15, 0, -0.22, 0), role: "pants" },
    { bone: "kneeL", geo: box(0.13, 0.42, 0.13, 0, -0.21, 0), role: "pants" },
    { bone: "kneeL", geo: box(0.14, 0.08, 0.26, 0, -0.45, 0.05), role: "dark" },
    { bone: "thighR", geo: box(0.15, 0.44, 0.15, 0, -0.22, 0), role: "pants" },
    { bone: "kneeR", geo: box(0.13, 0.42, 0.13, 0, -0.21, 0), role: "pants" },
    { bone: "kneeR", geo: box(0.14, 0.08, 0.26, 0, -0.45, 0.05), role: "dark" },
    // glow: eyes and the charged "heart" visible through a torn chest
    { bone: "head", geo: box(0.045, 0.025, 0.02, 0.055, 0.13, 0.15), role: "glow" },
    { bone: "head", geo: box(0.045, 0.025, 0.02, -0.055, 0.13, 0.15), role: "glow" },
    { bone: "chest", geo: box(0.1, 0.1, 0.02, 0.06, 0.16, 0.135), role: "glow" },
    { bone: "chest", geo: box(0.02, 0.22, 0.015, 0.02, 0.1, 0.137, 0.2), role: "glow" },
  ];
  if (L.vest) {
    p.push({ bone: "chest", geo: box(0.48 * w, 0.3, 0.28, 0, 0.1, 0), role: "accent" });
    p.push({ bone: "chest", geo: box(0.48 * w, 0.03, 0.285, 0, 0.05, 0), role: "glow" });
  }
  if (kind === "brute") {
    p.push({ bone: "chest", geo: box(0.62, 0.22, 0.3, 0, 0.24, -0.02), role: "shirt" });
    p.push({ bone: "elbowL", geo: box(0.13, 0.16, 0.08, 0, -0.34, 0.01), role: "skin" });
    p.push({ bone: "elbowR", geo: box(0.13, 0.16, 0.08, 0, -0.34, 0.01), role: "skin" });
  }
  if (L.crown) {
    // Copper coils fused into the skull: the Conductor draws the grid to itself.
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      const g = new THREE.CylinderGeometry(0.018, 0.024, 0.22, 6);
      g.translate(Math.cos(a) * 0.12, 0.34, Math.sin(a) * 0.12);
      p.push({ bone: "head", geo: g.toNonIndexed(), role: "accent" });
      const tip = new THREE.SphereGeometry(0.03, 6, 4);
      tip.translate(Math.cos(a) * 0.12, 0.46, Math.sin(a) * 0.12);
      p.push({ bone: "head", geo: tip.toNonIndexed(), role: "glow" });
    }
    for (const side of [1, -1]) {
      const rod = new THREE.CylinderGeometry(0.03, 0.03, 0.4, 6);
      rod.translate(side * 0.3, 0.42, -0.05);
      p.push({ bone: "chest", geo: rod.toNonIndexed(), role: "accent" });
    }
  }
  return p;
}

export interface ZombieTemplate {
  kind: EnemyKind;
  body: THREE.BufferGeometry;
  glow: THREE.BufferGeometry;
  /** Per-bone geometry for death debris, in bone-local space. */
  debris: Array<{ bone: number; geo: THREE.BufferGeometry }>;
  bind: Record<BoneName, { parent: BoneName | null; pos: [number, number, number] }>;
}

const templates = new Map<EnemyKind, ZombieTemplate>();

export function zombieTemplate(kind: EnemyKind): ZombieTemplate {
  const cached = templates.get(kind);
  if (cached) return cached;
  const look = LOOKS[kind];
  const bind = bindSkeleton(look.width);

  // World-space bind position of each bone (no rotations in the bind pose).
  const world = {} as Record<BoneName, THREE.Vector3>;
  for (const name of BONES) {
    const b = bind[name];
    const v = new THREE.Vector3(...b.pos);
    if (b.parent) v.add(world[b.parent]);
    world[name] = v;
  }

  const bodyParts: THREE.BufferGeometry[] = [];
  const glowParts: THREE.BufferGeometry[] = [];
  const debrisByBone = new Map<number, THREE.BufferGeometry[]>();
  for (const part of partsFor(kind)) {
    const boneIndex = BONES.indexOf(part.bone);
    const g = part.geo.clone();
    g.translate(world[part.bone].x, world[part.bone].y, world[part.bone].z);
    const n = g.attributes.position!.count;
    const skinIndex = new Uint16Array(n * 4);
    const skinWeight = new Float32Array(n * 4);
    const colors = new Float32Array(n * 3);
    const c = new THREE.Color(part.role === "glow" ? 0xffffff : look.colors[part.role]);
    for (let i = 0; i < n; i++) {
      skinIndex[i * 4] = boneIndex;
      skinWeight[i * 4] = 1;
      // Grime: darken lower vertices a touch so silhouettes read from the street.
      const y = g.attributes.position!.getY(i);
      const shade = part.role === "glow" ? 1 : 0.78 + 0.22 * Math.min(1, y / 1.7);
      colors[i * 3] = c.r * shade;
      colors[i * 3 + 1] = c.g * shade;
      colors[i * 3 + 2] = c.b * shade;
    }
    g.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(skinIndex, 4));
    g.setAttribute("skinWeight", new THREE.Float32BufferAttribute(skinWeight, 4));
    g.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    g.deleteAttribute("uv");
    (part.role === "glow" ? glowParts : bodyParts).push(g);
    if (part.role !== "glow") {
      const local = part.geo.clone();
      local.deleteAttribute("uv");
      const list = debrisByBone.get(boneIndex) ?? [];
      list.push(local);
      debrisByBone.set(boneIndex, list);
    }
  }

  const debris = [...debrisByBone.entries()].map(([bone, geos]) => ({ bone, geo: mergeGeometries(geos)! }));
  const t: ZombieTemplate = {
    kind,
    body: mergeGeometries(bodyParts)!,
    glow: mergeGeometries(glowParts)!,
    debris,
    bind,
  };
  t.body.computeBoundingSphere();
  templates.set(kind, t);
  return t;
}

/** One live zombie: its own skeleton, materials (for hit flashes) and gait state. */
export class ZombieRig {
  readonly root = new THREE.Group();
  readonly bones: THREE.Bone[];
  readonly bodyMat: THREE.MeshStandardMaterial;
  readonly glowMat: THREE.MeshBasicMaterial;
  readonly look: KindLook;
  private readonly body: THREE.SkinnedMesh;
  private readonly glow: THREE.SkinnedMesh;
  private phase: number;
  private flinch = 0;
  private flash = 0;

  constructor(
    readonly kind: EnemyKind,
    variant: number,
  ) {
    const t = zombieTemplate(kind);
    this.look = LOOKS[kind];
    this.phase = variant * 6.283;

    const byName = new Map<BoneName, THREE.Bone>();
    this.bones = BONES.map((name) => {
      const b = new THREE.Bone();
      b.name = name;
      b.position.set(...t.bind[name].pos);
      byName.set(name, b);
      return b;
    });
    for (const name of BONES) {
      const parent = t.bind[name].parent;
      if (parent) byName.get(parent)!.add(byName.get(name)!);
    }

    const tint = new THREE.Color().setHSL(0, 0, 0.9 + variant * 0.2);
    this.bodyMat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      flatShading: true,
      roughness: 0.82,
      metalness: 0.05,
      color: tint,
      transparent: kind === "wraith",
      opacity: 1,
    });
    this.glowMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(this.look.glow).multiplyScalar(2.2), transparent: true });

    this.body = new THREE.SkinnedMesh(t.body, this.bodyMat);
    this.glow = new THREE.SkinnedMesh(t.glow, this.glowMat);
    this.body.add(this.bones[0]!);
    // Bone inverses come from the bind pose, so world matrices must be current first.
    this.body.updateMatrixWorld(true);
    const skeleton = new THREE.Skeleton(this.bones);
    this.body.bind(skeleton);
    this.glow.bind(skeleton);
    this.body.castShadow = true;
    this.body.frustumCulled = false;
    this.glow.frustumCulled = false;
    // Face +X: they walk from the left of the screen to the right.
    const facing = new THREE.Group();
    facing.rotation.y = Math.PI / 2;
    facing.add(this.body, this.glow);
    this.root.add(facing);
  }

  hitFlash(strength = 1): void {
    this.flash = Math.max(this.flash, strength);
    this.flinch = Math.min(1, this.flinch + 0.7 * strength);
  }

  setOpacity(o: number): void {
    this.bodyMat.opacity = o;
    this.glowMat.opacity = Math.min(1, o * 1.2);
    this.bodyMat.depthWrite = o > 0.95;
  }

  /** speed: world units per second, used to match stride to ground speed. */
  animate(dt: number, speed: number, unrest: number): void {
    const L = this.look;
    const B = this.bones;
    this.phase += dt * Math.PI * 2 * L.stepHz * (0.6 + Math.min(1.8, speed / 1.6) * 0.4);
    const p = this.phase;
    const s = Math.sin(p);
    const c = Math.cos(p);
    this.flinch = Math.max(0, this.flinch - dt * 4);
    this.flash = Math.max(0, this.flash - dt * 5);

    const [hips, spine, chest, head, shL, elL, shR, elR, thL, knL, thR, knR] = B as [
      THREE.Bone, THREE.Bone, THREE.Bone, THREE.Bone, THREE.Bone, THREE.Bone,
      THREE.Bone, THREE.Bone, THREE.Bone, THREE.Bone, THREE.Bone, THREE.Bone,
    ];

    let stride = 0.45;
    let bob = 0.04;
    let kneeBend = 0.7;
    switch (L.gait) {
      case "run":
        stride = 0.85;
        bob = 0.07;
        kneeBend = 1.3;
        break;
      case "stomp":
        stride = 0.38;
        bob = 0.06;
        break;
      case "glide":
        stride = 0.08;
        bob = 0;
        kneeBend = 0.25;
        break;
      case "march":
        stride = 0.4;
        bob = 0.05;
        break;
      case "shamble":
        break;
    }

    hips.position.y = 0.95 + Math.abs(s) * bob + (L.gait === "glide" ? 0.18 + Math.sin(p * 0.7) * 0.06 : 0);
    hips.rotation.z = s * (L.gait === "shamble" ? 0.09 : 0.04);
    hips.rotation.y = s * 0.08;
    spine.rotation.x = L.lean * 0.5 - this.flinch * 0.5;
    chest.rotation.x = L.lean * 0.5 + (L.gait === "stomp" ? Math.abs(s) * 0.08 : 0);
    chest.rotation.y = -s * 0.12;
    head.rotation.z = Math.sin(p * 0.5) * 0.18 + unrest * Math.sin(p * 3.1) * 0.25;
    head.rotation.x = -L.lean * 0.4 + 0.1 * c;

    // Shamblers drag one leg: asymmetric stride.
    const drag = L.gait === "shamble" ? 0.55 : 1;
    thL.rotation.x = -s * stride;
    thR.rotation.x = s * stride * drag;
    knL.rotation.x = Math.max(0, Math.sin(p + 0.9)) * kneeBend;
    knR.rotation.x = Math.max(0, Math.sin(p + Math.PI + 0.9)) * kneeBend * drag;

    switch (L.armPose) {
      case "reach":
        shL.rotation.x = -1.35 + s * 0.12;
        shR.rotation.x = -1.25 - s * 0.14;
        shL.rotation.z = 0.08;
        shR.rotation.z = -0.08;
        elL.rotation.x = -0.25 + c * 0.1;
        elR.rotation.x = -0.35 - c * 0.1;
        break;
      case "swing":
        shL.rotation.x = s * (L.gait === "run" ? 0.9 : 0.45);
        shR.rotation.x = -s * (L.gait === "run" ? 0.9 : 0.45);
        shL.rotation.z = 0.12;
        shR.rotation.z = -0.12;
        elL.rotation.x = L.gait === "run" ? -1.1 : -0.2;
        elR.rotation.x = L.gait === "run" ? -1.1 : -0.2;
        break;
      case "dangle":
        shL.rotation.x = 0.15 + Math.sin(p * 0.8) * 0.1;
        shR.rotation.x = 0.1 - Math.sin(p * 0.8) * 0.1;
        shL.rotation.z = 0.25;
        shR.rotation.z = -0.25;
        elL.rotation.x = -0.1;
        elR.rotation.x = -0.1;
        break;
    }

    this.bodyMat.emissive.setRGB(0.55 * this.flash, 0.85 * this.flash, 1.0 * this.flash);
  }

  /** World transforms of the body parts for death debris. */
  debrisPieces(): Array<{ geo: THREE.BufferGeometry; matrix: THREE.Matrix4 }> {
    const t = zombieTemplate(this.kind);
    this.root.updateWorldMatrix(true, true);
    return t.debris.map((d) => ({ geo: d.geo, matrix: this.bones[d.bone]!.matrixWorld.clone() }));
  }

  dispose(): void {
    this.bodyMat.dispose();
    this.glowMat.dispose();
  }
}
