import { describe, expect, it } from 'vitest'
import { findInChat } from './chatSearch'

const m = (id: number, text: string | null, extra: Partial<{ type: string; pending: boolean }> = {}) => ({
  id,
  type: 'text',
  text,
  ...extra,
})

/** Searching inside one chat (section 32). */
describe('search in a chat', () => {
  const chat = [m(1, 'Did you read the book?'), m(2, 'a photo', { type: 'photo' }), m(3, 'Which BOOK?'), m(4, 'hello')]

  it('finds every message with the words, newest first', () => {
    expect(findInChat(chat, 'book')).toEqual([3, 1])
  })

  it('finds nothing for nothing', () => {
    expect(findInChat(chat, '   ')).toEqual([])
  })

  it('looks only at text, and not at messages still on their way', () => {
    expect(findInChat([...chat, m(5, 'book', { pending: true })], 'photo')).toEqual([])
    expect(findInChat([...chat, m(5, 'book', { pending: true })], 'book')).toEqual([3, 1])
  })

  it('finds Persian words typed with Arabic letters', () => {
    expect(findInChat([m(1, 'این کتاب خوبی است')], 'كتاب')).toEqual([1])
  })
})
