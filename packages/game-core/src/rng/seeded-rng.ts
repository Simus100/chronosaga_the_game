export function seededUnit(seed: number): number {
  let t = seed >>> 0;
  t += 0x6d2b79f5;
  let x = Math.imul(t ^ (t >>> 15), 1 | t);
  x ^= x + Math.imul(x ^ (x >>> 7), 61 | x);
  return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
}

export function deterministicIndex(seed: number, length: number): number {
  if (length <= 0) throw new Error("length must be > 0");
  return Math.floor(seededUnit(seed) * length);
}
