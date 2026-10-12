import { describe, expect, it } from 'vitest';
import { STORAGE_KEY, loadWorld, saveWorld } from './storage';
import { createWorld, sealDailyHalf, type World } from './world';

const T0 = new Date(2026, 9, 12, 12).getTime();

/** A Storage that refuses everything, like some private browsing modes. */
const hostile: Storage = {
  length: 0,
  clear() {},
  key: () => null,
  getItem() {
    throw new Error('denied');
  },
  setItem() {
    throw new Error('denied');
  },
  removeItem() {},
};

describe('storage', () => {
  it('starts a new world when nothing is saved', () => {
    expect(loadWorld(window.localStorage, T0).status).toBe('new');
  });

  it('round-trips a world, dropping momentary notices', () => {
    const w: World = { ...sealDailyHalf(createWorld(T0, 3), T0, 'A perfectly fine half.'), notices: [] };
    w.notices.push({ id: 'n1', kind: 'their-pick', conversationId: 'c1', personId: 'mira' });
    expect(saveWorld(window.localStorage, w)).toBe(true);
    const loaded = loadWorld(window.localStorage, T0 + 1);
    expect(loaded.status).toBe('loaded');
    expect(loaded.world.days[0]!.mine!.text).toBe('A perfectly fine half.');
    expect(loaded.world.notices).toEqual([]);
  });

  it('recovers with a fresh world from corrupt or foreign data', () => {
    window.localStorage.setItem(STORAGE_KEY, '{not json');
    expect(loadWorld(window.localStorage, T0).status).toBe('recovered');
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 99 }));
    expect(loadWorld(window.localStorage, T0).status).toBe('recovered');
  });

  it('keeps working, honestly, when the browser refuses storage', () => {
    expect(loadWorld(hostile, T0).status).toBe('unavailable');
    expect(saveWorld(hostile, createWorld(T0))).toBe(false);
    expect(loadWorld(undefined, T0).status).toBe('unavailable');
  });
});
