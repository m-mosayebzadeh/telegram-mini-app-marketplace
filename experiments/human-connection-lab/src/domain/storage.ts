/**
 * Keeping the world in this browser.
 *
 * There is no server in this experiment, so the whole world lives in
 * localStorage. Storage can be missing or refuse writes (private windows,
 * blocked site data, a full quota); when it does, Halfway keeps working in
 * memory and tells the visitor their world won't be remembered, rather than
 * failing or pretending to save.
 */

import { createWorld, type World } from './world';

export const STORAGE_KEY = 'halfway.world.v2';
/** Where version one kept its world. Read only to tell the visitor why they start fresh. */
export const OLD_STORAGE_KEY = 'halfway.world.v1';

export type LoadResult =
  | { world: World; status: 'loaded' | 'new' }
  /** Something was saved but couldn't be read — a fresh world was started instead. */
  | { world: World; status: 'recovered' }
  /** A world from the first version of Halfway was found; conversations work differently now. */
  | { world: World; status: 'upgraded' }
  | { world: World; status: 'unavailable' };

/** The minimum shape a saved world must have before it is trusted. */
function looksLikeWorld(value: unknown): value is World {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Partial<World>;
  return (
    v.version === 2 &&
    typeof v.startedAt === 'number' &&
    typeof v.rng === 'number' &&
    Array.isArray(v.days) &&
    Array.isArray(v.conversations) &&
    Array.isArray(v.pending) &&
    Array.isArray(v.blocked)
  );
}

export function loadWorld(storage: Storage | undefined, now: number): LoadResult {
  if (!storage) return { world: createWorld(now), status: 'unavailable' };
  let raw: string | null;
  try {
    raw = storage.getItem(STORAGE_KEY);
  } catch {
    return { world: createWorld(now), status: 'unavailable' };
  }
  if (raw === null) {
    let old: string | null = null;
    try {
      old = storage.getItem(OLD_STORAGE_KEY);
      // Said once: the old world can't be carried over, so it isn't kept either.
      if (old !== null) storage.removeItem(OLD_STORAGE_KEY);
    } catch {
      // Unreadable old data changes nothing: start fresh either way.
    }
    return { world: createWorld(now), status: old === null ? 'new' : 'upgraded' };
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!looksLikeWorld(parsed)) return { world: createWorld(now), status: 'recovered' };
    // Notices are moments ("their half just arrived"); replaying them after a
    // reload would announce old news, so they are not carried across sessions.
    return { world: { ...parsed, notices: [] }, status: 'loaded' };
  } catch {
    return { world: createWorld(now), status: 'recovered' };
  }
}

/** Returns false when the browser refused the write. */
export function saveWorld(storage: Storage | undefined, world: World): boolean {
  if (!storage) return false;
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(world));
    return true;
  } catch {
    return false;
  }
}

export function clearWorld(storage: Storage | undefined): void {
  try {
    storage?.removeItem(STORAGE_KEY);
    storage?.removeItem(OLD_STORAGE_KEY);
  } catch {
    // Nothing to do: if storage is unreachable there is nothing saved to clear.
  }
}

/** localStorage itself can throw on access in some privacy modes. */
export function browserStorage(): Storage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}
