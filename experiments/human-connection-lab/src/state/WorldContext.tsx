/**
 * Holds the world for the interface: loads it, saves every change, runs the
 * simulated people's clock, and turns rule violations into a readable message
 * instead of a crash.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { browserStorage, clearWorld, loadWorld, saveWorld, type LoadResult } from '../domain/storage';
import { RuleError, advance, createWorld, worldNow, type World } from '../domain/world';

export type StorageState = LoadResult['status'] | 'failing';

interface WorldApi {
  world: World;
  /** The world's current time (real clock plus demo time travel). */
  now: number;
  /** Apply a rule. Returns false and shows the reason if the rule refused. */
  act: (change: (world: World, now: number) => World) => boolean;
  /** Same as act, for changes that need the real clock (time travel). */
  actReal: (change: (world: World, realNow: number) => World) => boolean;
  reset: () => void;
  storage: StorageState;
  error: string | null;
  clearError: () => void;
}

const Ctx = createContext<WorldApi | null>(null);

interface Props {
  children: ReactNode;
  /** Injected in tests; the real browser storage otherwise. */
  storage?: Storage;
  /** Injected in tests to control time. */
  clock?: () => number;
}

export function WorldProvider({ children, storage = browserStorage(), clock = Date.now }: Props) {
  const [initial] = useState(() => loadWorld(storage, clock()));
  const [world, setWorld] = useState<World>(initial.world);
  const [realNow, setRealNow] = useState(clock);
  const [storageState, setStorageState] = useState<StorageState>(initial.status);
  const [error, setError] = useState<string | null>(null);
  // The latest world for callbacks and the clock, which must not re-subscribe
  // on every change. Every change goes through commit(), which keeps it current.
  const worldRef = useRef(world);
  const storageRef = useRef<StorageState>(initial.status);

  /** Make a new world current and persist it. A refused write is reported, never thrown. */
  const commit = useCallback(
    (next: World) => {
      // Two actions in the same event (a double tap) must chain, not both start from the old world.
      worldRef.current = next;
      setWorld(next);
      if (storageRef.current !== 'unavailable' && !saveWorld(storage, next)) {
        storageRef.current = 'failing';
        setStorageState('failing');
      }
    },
    [storage],
  );

  // The simulated people's clock: once a second, deliver whatever has come due.
  // The interval also keeps "now" fresh so the daily question turns over at midnight.
  useEffect(() => {
    const tick = () => {
      const real = clock();
      setRealNow(real);
      const w = worldRef.current;
      const next = advance(w, worldNow(w, real));
      if (next !== w) commit(next);
    };
    const id = window.setInterval(tick, 1000);
    document.addEventListener('visibilitychange', tick);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [clock, commit]);

  const run = useCallback(
    (change: (w: World) => World) => {
      try {
        commit(change(worldRef.current));
        setError(null);
        return true;
      } catch (e) {
        if (e instanceof RuleError) {
          setError(e.message);
          return false;
        }
        throw e;
      }
    },
    [commit],
  );

  const act = useCallback(
    (change: (w: World, now: number) => World) => {
      const real = clock();
      setRealNow(real);
      return run((w) => change(w, worldNow(w, real)));
    },
    [clock, run],
  );

  const actReal = useCallback(
    (change: (w: World, realNow: number) => World) => {
      const real = clock();
      setRealNow(real);
      return run((w) => change(w, real));
    },
    [clock, run],
  );

  const reset = useCallback(() => {
    clearWorld(storage);
    const real = clock();
    setRealNow(real);
    // A reset world is saveable again even if an earlier write had failed.
    if (storageRef.current === 'failing') storageRef.current = 'new';
    setStorageState(storageRef.current);
    commit(createWorld(real));
    setError(null);
  }, [clock, storage, commit]);

  const api = useMemo<WorldApi>(
    () => ({
      world,
      now: worldNow(world, realNow),
      act,
      actReal,
      reset,
      storage: storageState,
      error,
      clearError: () => setError(null),
    }),
    [world, realNow, act, actReal, reset, storageState, error],
  );

  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

export function useWorld(): WorldApi {
  const api = useContext(Ctx);
  if (!api) throw new Error('useWorld must be used inside WorldProvider');
  return api;
}
