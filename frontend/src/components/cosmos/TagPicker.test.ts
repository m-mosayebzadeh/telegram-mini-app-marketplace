import { describe, expect, it, vi } from 'vitest'

vi.mock('../../lib/echoApi', async (original) => ({
  ...(await original<typeof import('../../lib/echoApi')>()),
  fetchTonightTags: vi.fn(),
}))

import { SEARCH_TAGS, TAG_GROUPS } from '../../lib/echoApi'
import { findTags, groupTags, NOW_COUNT, nowTags } from './TagPicker'

const order = (hot: string[] = []) => [
  ...hot.map((tag) => ({ tag, tonight: true })),
  ...SEARCH_TAGS.filter((tag) => !hot.includes(tag)).map((tag) => ({ tag, tonight: false })),
]
const label = (tag: string) => ({ film: 'Films', music: 'Film music' })[tag] ?? `Label ${tag}`
const groupLabel = (group: string) => ({ learning: 'Science' })[group] ?? group

/** Choosing Echo interests in groups (section 32). */
describe('which interests are shown', () => {
  it('has every interest in exactly one group, and few groups', () => {
    const every = Object.values(TAG_GROUPS).flat()
    expect(new Set(every).size).toBe(every.length)
    expect(Object.keys(TAG_GROUPS).length).toBeLessThanOrEqual(6)
  })

  it('offers the most chosen right now for one tap, five at most, none of yours', () => {
    const hot = ['nightowl', 'music', 'film', 'books', 'sport', 'travel']
    expect(nowTags(order(hot), ['music'])).toEqual(['nightowl', 'film', 'books', 'sport', 'travel'])
    expect(nowTags(order(hot), [])).toHaveLength(NOW_COUNT)
    // Nobody much in Echo: nothing is marked, and the row is not shown.
    expect(nowTags(order(), [])).toEqual([])
  })

  it('shows a group in the order of what is chosen right now, without what you chose', () => {
    expect(groupTags('talk', order(['smalltalk']), ['deeptalk'])).toEqual(['smalltalk', 'nightowl'])
  })

  it('finds interests from every group, and a group by its name', () => {
    expect(findTags('film', order(), [], label, groupLabel)).toEqual(['music', 'film'])
    expect(findTags('scien', order(), [], label, groupLabel)).toEqual([...TAG_GROUPS.learning])
    expect(findTags('  ', order(), [], label, groupLabel)).toEqual([])
  })

  it('does not find again what you already chose', () => {
    expect(findTags('film', order(), ['film'], label, groupLabel)).toEqual(['music'])
  })
})
