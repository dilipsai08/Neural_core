import { describe, expect, it } from "vitest";
import { RateAdapter, StreamDecoder } from "./stream-decoder.js";

/** Chords packet: C7 7C counter [hi lo]*n 01 */
function chordsPacket(counter: number, values: number[], littleEndian = false): number[] {
  const out = [0xc7, 0x7c, counter & 0xff];
  for (const v of values) out.push(...(littleEndian ? [v & 0xff, v >> 8] : [v >> 8, v & 0xff]));
  out.push(0x01);
  return out;
}

function chordsStream(count: number, channels: number, littleEndian = false): { bytes: Uint8Array; a0: number[] } {
  const bytes: number[] = [];
  const a0: number[] = [];
  for (let i = 0; i < count; i++) {
    const v = 8192 + Math.round(300 * Math.sin(i / 7));
    a0.push(v);
    const vals = [v, ...Array.from({ length: channels - 1 }, () => 8000 + i)];
    bytes.push(...chordsPacket(i, vals, littleEndian));
  }
  return { bytes: Uint8Array.from(bytes), a0 };
}

describe("StreamDecoder", () => {
  it("decodes the Chords 6-channel binary stream and keeps channel A0", () => {
    const { bytes, a0 } = chordsStream(400, 6);
    const d = new StreamDecoder();
    const samples: number[] = [];
    let bits: number | null = null;
    // feed in awkward chunk sizes, starting mid-packet
    for (let i = 5; i < bytes.length; i += 37) {
      const b = d.push(bytes.slice(i, Math.min(bytes.length, i + 37)));
      samples.push(...b.samples);
      bits = b.bits ?? bits;
    }
    expect(d.protocol).toBe("chords");
    expect(d.channels).toBe(6);
    expect(bits).toBe(14);
    expect(samples.length).toBeGreaterThan(390);
    expect(samples).toEqual(a0.slice(a0.length - samples.length));
  });

  it("detects the channel count and little-endian order", () => {
    const { bytes, a0 } = chordsStream(300, 3, true);
    const d = new StreamDecoder();
    const out = d.push(bytes);
    expect(d.channels).toBe(3);
    expect(out.samples.slice(-10)).toEqual(a0.slice(-10));
  });

  it("resyncs after a dropped byte", () => {
    const { bytes } = chordsStream(200, 6);
    const broken = Uint8Array.from([...bytes.slice(0, 1000), ...bytes.slice(1001)]);
    const d = new StreamDecoder();
    const out = d.push(broken);
    expect(out.samples.length).toBeGreaterThan(190);
    expect(out.samples.every((v) => v > 7000 && v < 9000)).toBe(true);
  });

  it("decodes the Neural Core text firmware", () => {
    const d = new StreamDecoder();
    const text = "#NC1 fs=250 bits=14 board=UNO_R4\n" + Array.from({ length: 50 }, (_, i) => `${8000 + i}\r\n`).join("");
    const out = d.push(new TextEncoder().encode(text));
    expect(d.protocol).toBe("text");
    expect(out.bits).toBe(14);
    expect(out.samples.slice(0, 3)).toEqual([8000, 8001, 8002]);
    expect(d.push(new TextEncoder().encode("8100\n81")).samples).toEqual([8100]);
    expect(d.push(new TextEncoder().encode("01\n")).samples).toEqual([8101]);
  });
});

describe("RateAdapter", () => {
  function feed(rate: number) {
    const out: number[] = [];
    const a = new RateAdapter((c) => out.push(c));
    for (let t = 0; t <= 4000; t += 20) a.push(Array.from({ length: (rate * 20) / 1000 }, () => 100), t);
    return { a, out };
  }

  it("passes 250 Hz straight through", () => {
    const { a } = feed(250);
    expect(a.factor).toBe(1);
  });

  it("halves Chords' 500 Hz by averaging pairs", () => {
    const out: number[] = [];
    const a = new RateAdapter((c) => out.push(c));
    for (let t = 0; t <= 3000; t += 20) a.push(Array.from({ length: 10 }, (_, i) => (i % 2 ? 110 : 90)), t);
    expect(a.rateHz).toBeGreaterThan(480);
    expect(a.rateHz).toBeLessThan(520);
    expect(a.factor).toBe(2);
    expect(out.every((v) => v === 100)).toBe(true);
  });
});
