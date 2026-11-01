/**
 * Mulberry32 — deterministic 32-bit seeded PRNG.
 * All gameplay randomness must pass through this generator.
 */
export function createSeededRng(seed: number): () => number {
  let s = seed | 0;

  return function mulberry32(): number {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

export function seededInt(rng: () => number, min: number, max: number): number {
  return Math.floor(rng() * (max - min + 1)) + min;
}

export function seededRange(rng: () => number, min: number, max: number): number {
  return min + rng() * (max - min);
}

export function seededPick<T>(rng: () => number, arr: readonly T[]): T {
  const idx = Math.floor(rng() * arr.length);
  return arr[Math.min(idx, arr.length - 1)]!;
}

/** Pick a key from a weight table. Weights need not sum to 1. */
export function seededWeighted<K extends string>(
  rng: () => number,
  weights: Readonly<Partial<Record<K, number>>>,
): K {
  const entries = Object.entries(weights) as Array<[K, number]>;
  const total = entries.reduce((acc, [, w]) => acc + w, 0);
  let roll = rng() * total;
  for (const [key, w] of entries) {
    roll -= w;
    if (roll <= 0) return key;
  }
  return entries[entries.length - 1]![0];
}

/** Integer hash used to derive per-entity noise seeds without allocating RNGs. */
export function hash32(a: number, b = 0): number {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x632be5ab, 0xc2b2ae35);
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d);
  h ^= h >>> 15;
  return h >>> 0;
}

/**
 * Smooth deterministic 1D value noise in [-1, 1].
 * Used for focus-driven jitter (not random per frame, so motion stays organic).
 */
export function noise1(seed: number, x: number): number {
  const i = Math.floor(x);
  const f = x - i;
  const a = (hash32(seed, i) / 4_294_967_296) * 2 - 1;
  const b = (hash32(seed, i + 1) / 4_294_967_296) * 2 - 1;
  const u = f * f * f * (f * (f * 6 - 15) + 10);
  return a + (b - a) * u;
}

/** Two octaves of noise1, still in [-1, 1]. */
export function fbm1(seed: number, x: number): number {
  return (noise1(seed, x) * 2 + noise1(seed + 101, x * 2.3)) / 3;
}
