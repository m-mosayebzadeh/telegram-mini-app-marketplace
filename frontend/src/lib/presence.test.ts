import { describe, expect, it } from 'vitest'
import { withPresence } from './presence'

describe('a ring that lights at once', () => {
  const people = [
    { user_id: 1, online: false },
    { user_id: 2, online: true },
  ]

  it('lights the ring of whoever arrived', () => {
    expect(withPresence(people, 1, true)).toEqual([
      { user_id: 1, online: true },
      { user_id: 2, online: true },
    ])
  })

  it('puts it out when they leave', () => {
    expect(withPresence(people, 2, false)?.[1].online).toBe(false)
  })

  it('changes nothing for somebody not in this world, or news already shown', () => {
    expect(withPresence(people, 9, true)).toBe(people)
    expect(withPresence(people, 2, true)).toBe(people)
  })
})
