import { describe, expect, it } from "vitest";
import { Biquad, Ring, bandPower, fft, robustStd, welchPsd } from "./dsp.js";

const FS = 250;
const sine = (f: number, n: number, amp = 1) => Array.from({ length: n }, (_, i) => amp * Math.sin((2 * Math.PI * f * i) / FS));
const rms = (xs: number[]) => Math.sqrt(xs.reduce((a, v) => a + v * v, 0) / xs.length);

describe("fft", () => {
  it("puts a pure tone in the right bin", () => {
    const n = 256;
    const re = new Float64Array(Array.from({ length: n }, (_, i) => Math.cos((2 * Math.PI * 8 * i) / n)));
    const im = new Float64Array(n);
    fft(re, im);
    const mags = Array.from(re, (v, i) => Math.hypot(v, im[i]!));
    expect(mags.indexOf(Math.max(...mags.slice(0, n / 2)))).toBe(8);
  });
});

describe("filters", () => {
  it("notch removes mains but keeps alpha", () => {
    const notch = Biquad.notch(FS, 50);
    const mains = sine(50, 2000).map((v) => notch.process(v)).slice(1000);
    const notch2 = Biquad.notch(FS, 50);
    const alpha = sine(10, 2000).map((v) => notch2.process(v)).slice(1000);
    expect(rms(mains)).toBeLessThan(0.05);
    expect(rms(alpha)).toBeGreaterThan(0.65);
  });

  it("low-pass attenuates 80 Hz", () => {
    const lp = Biquad.lowpass(FS, 45);
    const out = sine(80, 2000).map((v) => lp.process(v)).slice(1000);
    expect(rms(out)).toBeLessThan(0.25);
  });
});

describe("welch band power", () => {
  it("finds the dominant band", () => {
    const x = sine(20, 500, 10).map((v, i) => v + sine(10, 500, 2)[i]!);
    const psd = welchPsd(x, 250, 256);
    const beta = bandPower(psd, FS, 256, 13, 30);
    const alpha = bandPower(psd, FS, 256, 8, 13);
    expect(beta / alpha).toBeGreaterThan(10);
  });
});

describe("helpers", () => {
  it("robust std ignores a spike", () => {
    const x = sine(10, 500, 1);
    x[250] = 500;
    expect(robustStd(x)).toBeLessThan(1.2);
  });

  it("ring keeps the newest values in order", () => {
    const r = new Ring(3);
    [1, 2, 3, 4, 5].forEach((v) => r.push(v));
    expect(Array.from(r.snapshot())).toEqual([3, 4, 5]);
  });
});
