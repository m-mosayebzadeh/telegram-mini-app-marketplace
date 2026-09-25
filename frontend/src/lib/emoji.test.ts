import { describe, expect, it } from 'vitest'
import { STARTING_REACTIONS, reactionRow } from './emoji'

describe('the reaction row', () => {
  it('starts with the fixed row', () => {
    expect(reactionRow({})).toEqual([...STARTING_REACTIONS])
  })

  it('brings what somebody uses most to the front', () => {
    const row = reactionRow({ '🙏': 5, '👏': 3 })
    expect(row.slice(0, 2)).toEqual(['🙏', '👏'])
    expect(row).toHaveLength(STARTING_REACTIONS.length)
  })

  it('is not rearranged by a single stray tap', () => {
    expect(reactionRow({ '🦄': 1 })).toEqual([...STARTING_REACTIONS])
  })

  it('never shows the same emoji twice', () => {
    const row = reactionRow({ '❤️': 9 })
    expect(new Set(row).size).toBe(row.length)
  })
})

describe('the full list', () => {
  it('works without the browser segmenter some phones lack', async () => {
    const saved = Intl.Segmenter
    // @ts-expect-error — simulating a browser that does not have it
    delete Intl.Segmenter
    try {
      const { EMOJI_GROUPS } = await import('./emojiSet')
      expect(EMOJI_GROUPS.every((group) => group.emoji.length > 0)).toBe(true)
    } finally {
      Object.defineProperty(Intl, 'Segmenter', { value: saved, configurable: true, writable: true })
    }
  })
})

describe('emoji as pictures', () => {
  it('names the picture by its code points, without FE0F', async () => {
    const { emojiFile } = await import('./emojiImage')
    expect(emojiFile('😀')).toBe('/emoji/1f600.webp')
    expect(emojiFile('❤️')).toBe('/emoji/2764.webp')
    expect(emojiFile('👋🏽')).toBe('/emoji/1f44b-1f3fd.webp')
    expect(emojiFile('❤️‍🔥')).toBe('/emoji/2764-200d-1f525.webp')
  })
})
