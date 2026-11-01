import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { AfterimagePass } from "three/examples/jsm/postprocessing/AfterimagePass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";

/**
 * The "distraction lens". Driven by the smoothed distortion value:
 * radial blur, chromatic split, static grain, desaturation and vignette rise
 * as focus drops, and the image snaps crisp when the player locks in.
 */
const FocusLensShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uDistort: { value: 0 },
    uTime: { value: 0 },
    uAlarm: { value: 0 },
    uLocked: { value: 0 },
    uAspect: { value: 16 / 9 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uDistort;
    uniform float uTime;
    uniform float uAlarm;
    uniform float uLocked;
    uniform float uAspect;
    varying vec2 vUv;

    float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }

    void main() {
      vec2 c = vUv - 0.5;
      float d = uDistort;
      // Lateral wobble of the whole image, like a failing CRT feed.
      float roll = sin(vUv.y * 40.0 + uTime * 9.0) * 0.004 * d * d;
      vec2 uv = vUv + vec2(roll, 0.0);

      // Radial blur toward the edges: the periphery smears first.
      vec3 acc = vec3(0.0);
      float total = 0.0;
      float strength = d * (0.02 + 0.06 * smoothstep(0.0, 0.55, length(c)));
      for (int i = 0; i < 6; i++) {
        float k = float(i) / 5.0;
        float w = 1.0 - k * 0.6;
        vec2 o = c * strength * k;
        float ca = d * 0.012 * (0.5 + k);
        acc.r += texture2D(tDiffuse, uv - o + c * ca).r * w;
        acc.g += texture2D(tDiffuse, uv - o).g * w;
        acc.b += texture2D(tDiffuse, uv - o - c * ca).b * w;
        total += w;
      }
      vec3 col = acc / total;

      // Desaturate and add static as the mind wanders.
      float luma = dot(col, vec3(0.299, 0.587, 0.114));
      col = mix(col, vec3(luma), d * 0.4);
      float grain = hash(vUv * vec2(1920.0, 1080.0) + fract(uTime) * 100.0) - 0.5;
      col += grain * (0.012 + d * 0.06);
      // Rolling interference bars only when the mind is clearly elsewhere.
      float band = step(0.992, fract(vUv.y * 2.0 - uTime * 0.7));
      col += band * smoothstep(0.45, 0.9, d) * 0.06;

      // Locked in: a faint cool grade and a crisp centre.
      col = mix(col, col * vec3(0.94, 1.02, 1.08), uLocked * 0.6);

      // Vignette, tinted red on a breach.
      vec2 v = c * vec2(uAspect, 1.0);
      float vig = smoothstep(0.35, 1.1, length(v) * (1.0 + d * 0.5));
      col *= 1.0 - vig * (0.55 + d * 0.25);
      col = mix(col, vec3(0.7, 0.05, 0.03), vig * uAlarm * 0.7);
      gl_FragColor = vec4(col, 1.0);
    }
  `,
};

export class PostFX {
  readonly composer: EffectComposer;
  private readonly afterimage: AfterimagePass;
  private readonly bloom: UnrealBloomPass;
  private readonly lens: ShaderPass;

  constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera, opts: { trails: boolean }) {
    const size = renderer.getSize(new THREE.Vector2());
    this.composer = new EffectComposer(renderer);
    this.composer.addPass(new RenderPass(scene, camera));
    this.afterimage = new AfterimagePass(0);
    this.afterimage.enabled = opts.trails;
    this.composer.addPass(this.afterimage);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), 0.85, 0.55, 0.82);
    this.composer.addPass(this.bloom);
    this.lens = new ShaderPass(FocusLensShader);
    this.composer.addPass(this.lens);
    this.composer.addPass(new OutputPass());
  }

  setSize(w: number, h: number): void {
    this.composer.setSize(w, h);
    this.bloom.resolution.set(w / 2, h / 2);
    this.lens.uniforms.uAspect!.value = w / h;
  }

  update(t: number, distortion: number, locked: number, alarm: number): void {
    this.lens.uniforms.uTime!.value = t;
    this.lens.uniforms.uDistort!.value = distortion;
    this.lens.uniforms.uLocked!.value = locked;
    this.lens.uniforms.uAlarm!.value = alarm;
    // Motion trails only appear when distracted: the "blurry" enemy effect.
    (this.afterimage.uniforms as { damp: { value: number } }).damp.value = Math.min(0.9, distortion * 0.98);
    this.bloom.strength = 0.75 + locked * 0.35;
  }

  render(): void {
    this.composer.render();
  }

  dispose(): void {
    this.composer.dispose();
  }
}
