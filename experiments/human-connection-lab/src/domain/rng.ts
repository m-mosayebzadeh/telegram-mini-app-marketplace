/**
 * A tiny seeded random number generator (mulberry32).
 *
 * The simulated people make choices — which question to pick, whether to lean
 * back, whether to keep going. Those choices come from a seed stored in the
 * world rather than from Math.random, so a saved world replays the same way
 * after a reload and tests can assert exact outcomes.
 */

/** Advances the state and returns a value in [0, 1) with the new state. */
export function nextRandom(state: number): [value: number, next: number] {
  const next = (state + 0x6d2b79f5) >>> 0;
  let t = next;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  const value = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  return [value, next];
}

/** Shuffles a copy of `items` deterministically from `seed`, without touching any stored state. */
export function seededShuffle<T>(items: readonly T[], seed: number): T[] {
  const out = [...items];
  let state = seed >>> 0;
  for (let i = out.length - 1; i > 0; i--) {
    const [r, s] = nextRandom(state);
    state = s;
    const j = Math.floor(r * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}
