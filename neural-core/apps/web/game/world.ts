import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { createSeededRng } from "@neural-core/shared";

/**
 * Substation 07 at night: wet street, chain-link fence with the breach gate,
 * transformers, the Neural Core reactor, pylons and a dead city skyline.
 * Static geometry is merged per material to keep draw calls low.
 */

export const LANES_Z = [3.2, -0.8, -4.8] as const;
export const GATE_X = 7.4;

const rng = createSeededRng(0x07);
const r = (a: number, b: number) => a + rng() * (b - a);

function canvasTexture(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  draw(c.getContext("2d")!);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function asphalt(): { map: THREE.CanvasTexture; rough: THREE.CanvasTexture } {
  const size = 512;
  const map = canvasTexture(size, size, (g) => {
    g.fillStyle = "#1a1c1e";
    g.fillRect(0, 0, size, size);
    for (let i = 0; i < 26000; i++) {
      const v = 18 + Math.floor(rng() * 26);
      g.fillStyle = `rgb(${v},${v + 1},${v + 2})`;
      g.fillRect(rng() * size, rng() * size, 1.5, 1.5);
    }
    g.strokeStyle = "rgba(8,9,10,0.85)";
    g.lineWidth = 1.4;
    for (let i = 0; i < 14; i++) {
      g.beginPath();
      let x = rng() * size;
      let y = rng() * size;
      g.moveTo(x, y);
      for (let k = 0; k < 7; k++) {
        x += r(-30, 30);
        y += r(-30, 30);
        g.lineTo(x, y);
      }
      g.stroke();
    }
  });
  // Puddles: dark, smooth patches in the roughness map read as wet reflections.
  const rough = canvasTexture(size, size, (g) => {
    g.fillStyle = "#d0d0d0";
    g.fillRect(0, 0, size, size);
    for (let i = 0; i < 6; i++) {
      const x = rng() * size;
      const y = rng() * size;
      const rad = r(40, 110);
      const grd = g.createRadialGradient(x, y, 0, x, y, rad);
      grd.addColorStop(0, "rgba(120,120,120,0.9)");
      grd.addColorStop(1, "rgba(208,208,208,0)");
      g.fillStyle = grd;
      g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
    }
  });
  rough.colorSpace = THREE.NoColorSpace;
  for (const t of [map, rough]) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(11, 8);
  }
  return { map, rough };
}

function chainLink(): THREE.CanvasTexture {
  const t = canvasTexture(128, 128, (g) => {
    g.clearRect(0, 0, 128, 128);
    g.strokeStyle = "rgba(170,180,186,0.85)";
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(0, 64);
    g.lineTo(64, 0);
    g.lineTo(128, 64);
    g.lineTo(64, 128);
    g.closePath();
    g.moveTo(-64, 64);
    g.lineTo(0, 0);
    g.moveTo(128, 0);
    g.lineTo(192, 64);
    g.stroke();
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(26, 5);
  return t;
}

function sign(lines: Array<{ text: string; size: number; color: string }>, bg: string, stripe = false): THREE.CanvasTexture {
  return canvasTexture(512, 320, (g) => {
    g.fillStyle = bg;
    g.fillRect(0, 0, 512, 320);
    if (stripe) {
      for (let x = -320; x < 512; x += 48) {
        g.fillStyle = "#f4c430";
        g.beginPath();
        g.moveTo(x, 0);
        g.lineTo(x + 24, 0);
        g.lineTo(x + 24 + 40, 40);
        g.lineTo(x + 40, 40);
        g.fill();
      }
      g.fillStyle = "#15130c";
    }
    let y = stripe ? 100 : 80;
    for (const l of lines) {
      g.fillStyle = l.color;
      g.font = `800 ${l.size}px "Barlow Condensed", "Arial Narrow", sans-serif`;
      g.textAlign = "center";
      g.fillText(l.text, 256, y);
      y += l.size * 1.05;
    }
    // weathering
    for (let i = 0; i < 900; i++) {
      g.fillStyle = `rgba(30,20,10,${rng() * 0.25})`;
      g.fillRect(rng() * 512, rng() * 320, 2, 2);
    }
  });
}

const SKY_VERT = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const SKY_FRAG = /* glsl */ `
  uniform float uTime;
  uniform float uFlash;
  varying vec3 vDir;
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
  }
  float fbm(vec2 p) { float v = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; } return v; }
  void main() {
    float h = clamp(vDir.y, -0.1, 1.0);
    vec3 top = vec3(0.012, 0.02, 0.026);
    vec3 horizon = vec3(0.07, 0.085, 0.075);
    vec3 fire = vec3(0.32, 0.12, 0.03);
    vec3 col = mix(horizon, top, smoothstep(0.0, 0.45, h));
    // Distant city fires on the horizon, left side.
    col += fire * smoothstep(0.18, 0.0, h) * smoothstep(0.3, -0.8, vDir.x) * 0.5;
    vec2 uv = vDir.xz / max(0.08, vDir.y + 0.25) * 1.4 + vec2(uTime * 0.01, 0.0);
    float c = fbm(uv);
    vec3 cloud = mix(vec3(0.02, 0.03, 0.035), vec3(0.09, 0.11, 0.12), c);
    col = mix(col, cloud, smoothstep(0.35, 0.75, c) * smoothstep(0.02, 0.25, h) * 0.85);
    col += vec3(0.55, 0.65, 0.8) * uFlash * smoothstep(0.3, 0.9, c) * smoothstep(0.0, 0.3, h);
    gl_FragColor = vec4(col, 1.0);
  }
`;

export class World {
  readonly group = new THREE.Group();
  readonly hemi: THREE.HemisphereLight;
  readonly moon: THREE.DirectionalLight;
  readonly reactorLight: THREE.PointLight;
  readonly impactLight: THREE.PointLight;
  readonly gateLight: THREE.PointLight;
  private readonly sky: THREE.ShaderMaterial;
  private readonly lamps: Array<{ light: THREE.PointLight; bulb: THREE.MeshBasicMaterial; base: number; broken: boolean }> = [];
  private readonly rain: THREE.LineSegments;
  private readonly rainPos: Float32Array;
  private readonly reactorRings: THREE.MeshBasicMaterial;

  private readonly gateMat: THREE.MeshBasicMaterial;
  private flash = 0;
  private nextFlash = 5;
  private gateAlarm = 0;
  onThunder: (() => void) | null = null;

  constructor(private readonly opts: { shadows: boolean; rainCount: number }) {
    const g = this.group;

    // ── sky, fog, light ────────────────────────────────────────────────
    this.sky = new THREE.ShaderMaterial({
      vertexShader: SKY_VERT,
      fragmentShader: SKY_FRAG,
      uniforms: { uTime: { value: 0 }, uFlash: { value: 0 } },
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
    });
    const skyMesh = new THREE.Mesh(new THREE.SphereGeometry(120, 32, 16), this.sky);
    skyMesh.renderOrder = -1;
    g.add(skyMesh);

    this.hemi = new THREE.HemisphereLight(0x4a6670, 0x14120e, 0.9);
    g.add(this.hemi);

    this.moon = new THREE.DirectionalLight(0x9fc4ff, 1.6);
    this.moon.position.set(-9, 18, 10);
    this.moon.target.position.set(0, 0, -1);
    if (opts.shadows) {
      this.moon.castShadow = true;
      this.moon.shadow.mapSize.set(2048, 2048);
      const cam = this.moon.shadow.camera;
      cam.left = -20;
      cam.right = 18;
      cam.top = 14;
      cam.bottom = -10;
      cam.near = 2;
      cam.far = 50;
      this.moon.shadow.bias = -0.0006;
      this.moon.shadow.normalBias = 0.03;
    }
    g.add(this.moon, this.moon.target);

    // Substation floodlight washes the street; a cold back light rims the horde.
    const flood = new THREE.SpotLight(0xcfe6ff, 520, 46, 0.62, 0.75, 1.6);
    flood.position.set(9, 10, 6);
    flood.target.position.set(-5, 0, -1.5);
    g.add(flood, flood.target);
    const rim = new THREE.DirectionalLight(0x7fd0e8, 1.4);
    rim.position.set(-2, 7, -22);
    g.add(rim);

    // ── ground ─────────────────────────────────────────────────────────
    const { map, rough } = asphalt();
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(220, 160),
      new THREE.MeshStandardMaterial({ map, roughnessMap: rough, roughness: 0.9, metalness: 0.15, color: 0x9aa0a4 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(0, 0, -40);
    ground.receiveShadow = opts.shadows;
    g.add(ground);

    // Faded lane paint between the three lanes.
    const paint: THREE.BufferGeometry[] = [];
    for (const z of [(LANES_Z[0] + LANES_Z[1]) / 2, (LANES_Z[1] + LANES_Z[2]) / 2]) {
      for (let x = -30; x < GATE_X - 1; x += 3.2) {
        const p = new THREE.PlaneGeometry(1.6, 0.12);
        p.rotateX(-Math.PI / 2);
        p.translate(x, 0.005, z);
        paint.push(p);
      }
    }
    const paintMesh = new THREE.Mesh(
      mergeGeometries(paint)!,
      new THREE.MeshStandardMaterial({ color: 0x8a7a3a, roughness: 0.7, transparent: true, opacity: 0.45 }),
    );
    paintMesh.receiveShadow = opts.shadows;
    g.add(paintMesh);

    // ── fence + gate ───────────────────────────────────────────────────
    const metal = new THREE.MeshStandardMaterial({ color: 0x59626a, roughness: 0.5, metalness: 0.7 });
    const posts: THREE.BufferGeometry[] = [];
    for (let z = 7; z >= -12; z -= 2.4) {
      const p = new THREE.CylinderGeometry(0.06, 0.07, 3.3, 8);
      p.translate(GATE_X, 1.65, z);
      posts.push(p);
    }
    const rail = new THREE.CylinderGeometry(0.035, 0.035, 19.5, 6);
    rail.rotateX(Math.PI / 2);
    rail.translate(GATE_X, 3.25, -2.5);
    posts.push(rail);
    // barbed wire coil along the top
    for (let i = 0; i < 26; i++) {
      const t = new THREE.TorusGeometry(0.22, 0.012, 4, 10);
      t.rotateY(Math.PI / 2);
      t.translate(GATE_X, 3.5, 7 - i * 0.75);
      posts.push(t);
    }
    const fenceFrame = new THREE.Mesh(mergeGeometries(posts.map((p) => p.toNonIndexed()))!, metal);
    fenceFrame.castShadow = opts.shadows;
    g.add(fenceFrame);

    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(19.5, 3.2),
      new THREE.MeshStandardMaterial({
        map: chainLink(),
        transparent: true,
        alphaTest: 0.35,
        side: THREE.DoubleSide,
        metalness: 0.6,
        roughness: 0.45,
        color: 0xb0b8bf,
      }),
    );
    mesh.rotation.y = Math.PI / 2;
    mesh.position.set(GATE_X, 1.6, -2.5);
    mesh.castShadow = opts.shadows;
    g.add(mesh);

    const danger = new THREE.Mesh(
      new THREE.PlaneGeometry(1.5, 0.94),
      new THREE.MeshStandardMaterial({
        map: sign(
          [
            { text: "DANGER", size: 92, color: "#c5281c" },
            { text: "11 000 VOLTS", size: 58, color: "#15130c" },
            { text: "KEEP OUT", size: 46, color: "#15130c" },
          ],
          "#e8e2d0",
        ),
        roughness: 0.6,
      }),
    );
    danger.rotation.y = -Math.PI / 2;
    danger.position.set(GATE_X - 0.05, 1.9, 1.2);
    g.add(danger);

    const subSign = new THREE.Mesh(
      new THREE.PlaneGeometry(2.2, 1.375),
      new THREE.MeshStandardMaterial({
        map: sign(
          [
            { text: "SUBSTATION 07", size: 76, color: "#15130c" },
            { text: "NEURAL CORE GRID", size: 44, color: "#15130c" },
          ],
          "#d8c070",
          true,
        ),
        roughness: 0.55,
      }),
    );
    subSign.rotation.y = -Math.PI / 2;
    subSign.position.set(GATE_X - 0.05, 2.1, -6.2);
    g.add(subSign);

    this.gateMat = new THREE.MeshBasicMaterial({ color: 0x401010, toneMapped: false });
    const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.14, 12, 8), this.gateMat);
    beacon.position.set(GATE_X - 0.1, 3.55, -1.2);
    g.add(beacon);
    this.gateLight = new THREE.PointLight(0xff3020, 0, 14, 2);
    this.gateLight.position.set(GATE_X - 0.6, 3.2, -1.2);
    g.add(this.gateLight);

    // ── substation yard ────────────────────────────────────────────────
    const yard: THREE.BufferGeometry[] = [];
    const ins: THREE.BufferGeometry[] = [];
    for (const [x, z, s] of [
      [10.5, 1.5, 1],
      [11.2, -3.5, 1.25],
      [14.5, -1, 1.1],
    ] as const) {
      const body = new THREE.BoxGeometry(2.2 * s, 2.4 * s, 1.6 * s);
      body.translate(x, 1.2 * s, z);
      yard.push(body.toNonIndexed());
      for (let k = -3; k <= 3; k++) {
        const fin = new THREE.BoxGeometry(0.06, 1.9 * s, 1.9 * s);
        fin.translate(x + k * 0.3 * s, 1.15 * s, z);
        yard.push(fin.toNonIndexed());
      }
      for (const dx of [-0.6, 0, 0.6]) {
        for (let k = 0; k < 6; k++) {
          const disc = new THREE.CylinderGeometry(0.16 - (k % 2) * 0.05, 0.16 - (k % 2) * 0.05, 0.1, 10);
          disc.translate(x + dx * s, 2.45 * s + k * 0.11, z);
          ins.push(disc.toNonIndexed());
        }
      }
    }
    const yardMesh = new THREE.Mesh(
      mergeGeometries(yard)!,
      new THREE.MeshStandardMaterial({ color: 0x3f4a44, roughness: 0.65, metalness: 0.45 }),
    );
    yardMesh.castShadow = yardMesh.receiveShadow = opts.shadows;
    g.add(yardMesh);
    g.add(new THREE.Mesh(mergeGeometries(ins)!, new THREE.MeshStandardMaterial({ color: 0x7a4b2e, roughness: 0.35, metalness: 0.1 })));

    // The Neural Core reactor: rings glow with the player's focus.
    const core: THREE.BufferGeometry[] = [];
    const shaft = new THREE.CylinderGeometry(0.9, 1.15, 7.5, 18, 1, true);
    shaft.translate(0, 3.75, 0);
    core.push(shaft.toNonIndexed());
    for (let i = 0; i < 4; i++) {
      const brace = new THREE.BoxGeometry(0.18, 7.8, 0.18);
      brace.translate(Math.cos((i * Math.PI) / 2) * 1.25, 3.9, Math.sin((i * Math.PI) / 2) * 1.25);
      core.push(brace.toNonIndexed());
    }
    const coreMesh = new THREE.Mesh(mergeGeometries(core)!, new THREE.MeshStandardMaterial({ color: 0x2a3036, metalness: 0.8, roughness: 0.35, side: THREE.DoubleSide }));
    coreMesh.position.set(13, 0, -8.5);
    coreMesh.castShadow = opts.shadows;
    g.add(coreMesh);
    this.reactorRings = new THREE.MeshBasicMaterial({ color: new THREE.Color(0x7fe3ff).multiplyScalar(1.5), toneMapped: false });
    const rings: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 6; i++) {
      const t = new THREE.TorusGeometry(1.02 - i * 0.02, 0.05, 6, 32);
      t.rotateX(Math.PI / 2);
      t.translate(0, 1.2 + i * 1.1, 0);
      rings.push(t.toNonIndexed());
    }
    const ringMesh = new THREE.Mesh(mergeGeometries(rings)!, this.reactorRings);
    ringMesh.position.copy(coreMesh.position);
    g.add(ringMesh);
    this.reactorLight = new THREE.PointLight(0x7fe3ff, 40, 22, 2);
    this.reactorLight.position.set(13, 4, -7);
    g.add(this.reactorLight);

    // ── pylons and sagging lines ───────────────────────────────────────
    const lattice: THREE.BufferGeometry[] = [];
    const tops: THREE.Vector3[][] = [];
    for (const [px, pz] of [
      [-26, -20],
      [-4, -22],
      [18, -21],
    ] as const) {
      const legs: Array<[number, number]> = [
        [-1.6, -1.6],
        [1.6, -1.6],
        [1.6, 1.6],
        [-1.6, 1.6],
      ];
      const h = 17;
      for (const [lx, lz] of legs) {
        const leg = new THREE.CylinderGeometry(0.08, 0.12, h, 4);
        const top = new THREE.Vector3(lx * 0.25, h, lz * 0.25);
        const bottom = new THREE.Vector3(lx, 0, lz);
        const mid = top.clone().add(bottom).multiplyScalar(0.5);
        const dir = top.clone().sub(bottom).normalize();
        leg.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir));
        leg.translate(px + mid.x, mid.y, pz + mid.z);
        lattice.push(leg.toNonIndexed());
      }
      for (let y = 2; y < 16; y += 2.2) {
        const s = 1.6 * (1 - (y / 17) * 0.75);
        const brace = new THREE.BoxGeometry(s * 2, 0.07, 0.07);
        brace.translate(px, y, pz - s);
        lattice.push(brace.toNonIndexed());
        const brace2 = brace.toNonIndexed();
        brace2.translate(0, 0, s * 2);
        lattice.push(brace2);
        const x1 = new THREE.BoxGeometry(0.06, 2.6, 0.06);
        x1.rotateX(0.55);
        x1.translate(px + s, y + 1.1, pz);
        lattice.push(x1.toNonIndexed());
      }
      const arm = new THREE.BoxGeometry(0.16, 0.16, 9);
      arm.translate(px, 14.5, pz);
      lattice.push(arm.toNonIndexed());
      const arm2 = new THREE.BoxGeometry(0.14, 0.14, 6.5);
      arm2.translate(px, 16.4, pz);
      lattice.push(arm2.toNonIndexed());
      tops.push([new THREE.Vector3(px, 14.3, pz - 4.3), new THREE.Vector3(px, 14.3, pz + 4.3), new THREE.Vector3(px, 16.2, pz)]);
    }
    const pylonMesh = new THREE.Mesh(mergeGeometries(lattice)!, new THREE.MeshStandardMaterial({ color: 0x23282c, metalness: 0.6, roughness: 0.6 }));
    g.add(pylonMesh);
    const wires: THREE.BufferGeometry[] = [];
    for (let i = 0; i < tops.length - 1; i++) {
      for (let k = 0; k < 3; k++) {
        const a = tops[i]![k]!;
        const b = tops[i + 1]![k]!;
        const mid = a.clone().lerp(b, 0.5);
        mid.y -= 3.2;
        const curve = new THREE.CatmullRomCurve3([a, a.clone().lerp(mid, 0.55).setY(mid.y + 1.2), mid, b.clone().lerp(mid, 0.55).setY(mid.y + 1.2), b]);
        wires.push(new THREE.TubeGeometry(curve, 30, 0.035, 4).toNonIndexed());
      }
    }
    g.add(new THREE.Mesh(mergeGeometries(wires)!, new THREE.MeshBasicMaterial({ color: 0x0b0d0f })));

    // ── skyline ────────────────────────────────────────────────────────
    const blocks: THREE.BufferGeometry[] = [];
    const windows: THREE.Matrix4[] = [];
    for (let x = -110; x < 110; x += r(4, 9)) {
      const w = r(4, 9);
      const h = r(5, 16);
      const z = r(-95, -80);
      const b = new THREE.BoxGeometry(w, h, r(4, 8));
      b.translate(x, h / 2, z);
      blocks.push(b.toNonIndexed());
      for (let k = 0; k < Math.floor(h / 3); k++) {
        if (rng() < 0.16) windows.push(new THREE.Matrix4().makeTranslation(x + r(-w / 2.5, w / 2.5), r(2, h - 1), z + 4.1));
      }
    }
    g.add(new THREE.Mesh(mergeGeometries(blocks)!, new THREE.MeshBasicMaterial({ color: 0x050708, fog: false })));
    const win = new THREE.InstancedMesh(
      new THREE.PlaneGeometry(0.9, 1.1),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffb35a).multiplyScalar(0.55), fog: false }),
      windows.length,
    );
    windows.forEach((m, i) => win.setMatrixAt(i, m));
    g.add(win);

    // ── street lamps ───────────────────────────────────────────────────
    const lampGeo: THREE.BufferGeometry[] = [];
    for (const [x, z, broken] of [
      [-12, -8.2, false],
      [-1, -8.2, true],
      [-19, 6.5, false],
    ] as const) {
      const pole = new THREE.CylinderGeometry(0.08, 0.11, 6.2, 8);
      pole.translate(x, 3.1, z);
      lampGeo.push(pole.toNonIndexed());
      const arm = new THREE.BoxGeometry(1.4, 0.1, 0.1);
      arm.translate(x + 0.65, 6.1, z);
      lampGeo.push(arm.toNonIndexed());
      const head = new THREE.BoxGeometry(0.6, 0.16, 0.3);
      head.translate(x + 1.3, 6.02, z);
      lampGeo.push(head.toNonIndexed());
      const bulb = new THREE.MeshBasicMaterial({ color: 0xffb060, toneMapped: false });
      const bulbMesh = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.04, 0.2), bulb);
      bulbMesh.position.set(x + 1.3, 5.92, z);
      g.add(bulbMesh);
      const light = new THREE.PointLight(0xff9f45, 55, 18, 1.8);
      light.position.set(x + 1.3, 5.6, z);
      g.add(light);
      this.lamps.push({ light, bulb, base: 55, broken });
    }
    const lampMesh = new THREE.Mesh(mergeGeometries(lampGeo)!, metal);
    lampMesh.castShadow = opts.shadows;
    g.add(lampMesh);

    // ── wreckage: a burnt car and jersey barriers give the street scale ──
    const wreck: THREE.BufferGeometry[] = [];
    const carBody = new THREE.BoxGeometry(4.2, 0.8, 1.9);
    carBody.translate(-9, 0.75, -10.5);
    wreck.push(carBody.toNonIndexed());
    const cabin = new THREE.BoxGeometry(2.2, 0.7, 1.7);
    cabin.translate(-9.3, 1.5, -10.5);
    wreck.push(cabin.toNonIndexed());
    for (const [x, z, ry] of [
      [-15, -8.8, 0.15],
      [-13.2, -9.4, -0.1],
      [3.5, -9.6, 0.25],
      [5.6, 7.8, 1.2],
    ] as const) {
      const shape = new THREE.Shape();
      shape.moveTo(-0.32, 0);
      shape.lineTo(0.32, 0);
      shape.lineTo(0.12, 0.3);
      shape.lineTo(0.1, 0.8);
      shape.lineTo(-0.1, 0.8);
      shape.lineTo(-0.12, 0.3);
      const bar = new THREE.ExtrudeGeometry(shape, { depth: 2, bevelEnabled: false });
      bar.translate(0, 0, -1);
      bar.rotateY(ry);
      bar.translate(x, 0, z);
      wreck.push(bar.toNonIndexed());
    }
    const wreckMesh = new THREE.Mesh(mergeGeometries(wreck.map((w) => {
      w.deleteAttribute("uv");
      return w;
    }))!, new THREE.MeshStandardMaterial({ color: 0x4a4d50, roughness: 0.85, metalness: 0.2 }));
    wreckMesh.castShadow = wreckMesh.receiveShadow = opts.shadows;
    g.add(wreckMesh);

    this.impactLight = new THREE.PointLight(0x9fe8ff, 0, 10, 2);
    g.add(this.impactLight);

    // ── rain ───────────────────────────────────────────────────────────
    const n = opts.rainCount;
    this.rainPos = new Float32Array(n * 6);
    for (let i = 0; i < n; i++) this.resetDrop(i, r(0, 14));
    const rainGeo = new THREE.BufferGeometry();
    rainGeo.setAttribute("position", new THREE.BufferAttribute(this.rainPos, 3).setUsage(THREE.DynamicDrawUsage));
    this.rain = new THREE.LineSegments(
      rainGeo,
      new THREE.LineBasicMaterial({ color: 0x8aa4b4, transparent: true, opacity: 0.28, depthWrite: false }),
    );
    this.rain.frustumCulled = false;
    g.add(this.rain);
  }

  private resetDrop(i: number, y: number): void {
    const x = r(-24, 22);
    const z = r(-14, 12);
    this.rainPos.set([x, y, z, x + 0.05, y + 0.55, z], i * 6);
  }

  /** focusLevel 0-1 lights the reactor: the Neural Core visibly answers the player's mind. */
  setCharge(focusLevel: number): void {
    const glow = 0.25 + focusLevel * 1.6;
    this.reactorRings.color.setRGB(0.5 * glow, 0.89 * glow, 1.0 * glow);
    this.reactorLight.intensity = 10 + focusLevel * 60;
  }

  alarm(): void {
    this.gateAlarm = 1.2;
  }

  /** Big sky flash, with a thunder callback for the audio layer. */
  lightning(): void {
    this.flash = 1;
    this.onThunder?.();
  }

  update(dt: number, t: number, distortion: number): void {
    this.sky.uniforms.uTime!.value = t;
    this.nextFlash -= dt;
    if (this.nextFlash <= 0) {
      this.lightning();
      this.nextFlash = r(7, 15);
    }
    // double-strike flicker
    const f = this.flash;
    this.sky.uniforms.uFlash!.value = f * (0.6 + 0.4 * Math.sin(t * 60));
    this.hemi.intensity = 0.9 + f * 2.4;
    this.flash = Math.max(0, f - dt * 2.4);

    for (const lamp of this.lamps) {
      let k = 1;
      if (lamp.broken) k = Math.sin(t * 23) > 0.3 && Math.sin(t * 3.1) > -0.6 ? 1 : 0.08;
      // Distraction makes the whole grid stutter.
      if (distortion > 0.35 && Math.sin(t * 17 + lamp.base) > 1.15 - distortion * 0.5) k *= 0.25;
      lamp.light.intensity = lamp.base * k;
      lamp.bulb.color.setRGB(1 * k + 0.05, 0.69 * k + 0.03, 0.38 * k + 0.02);
    }

    this.gateAlarm = Math.max(0, this.gateAlarm - dt);
    const on = this.gateAlarm > 0 && Math.sin(t * 22) > 0;
    this.gateLight.intensity = on ? 45 : 0;
    this.gateMat.color.setRGB(on ? 3 : 0.25, on ? 0.3 : 0.06, on ? 0.2 : 0.06);

    this.impactLight.intensity = Math.max(0, this.impactLight.intensity - dt * 400);

    const p = this.rainPos;
    const fall = 16 * dt;
    for (let i = 0; i < p.length; i += 6) {
      p[i + 1] = p[i + 1]! - fall;
      p[i + 4] = p[i + 4]! - fall;
      p[i] = p[i]! - fall * 0.05;
      p[i + 3] = p[i + 3]! - fall * 0.05;
      if (p[i + 1]! < 0) this.resetDrop(i / 6, 14);
    }
    this.rain.geometry.attributes.position!.needsUpdate = true;
  }

  flashImpact(at: THREE.Vector3, strength = 1): void {
    this.impactLight.position.copy(at).setY(Math.max(1, at.y));
    this.impactLight.intensity = 120 * strength;
  }
}
