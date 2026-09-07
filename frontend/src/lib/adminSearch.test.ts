import { describe, expect, it } from 'vitest'
import { shouldRunAdminSearch } from './adminSearch'

describe('shouldRunAdminSearch', () => {
  it('stays paused for an empty query (shows the default assistants list)', () => {
    expect(shouldRunAdminSearch('')).toBe(false)
  })

  it('stays paused for 1-2 characters', () => {
    expect(shouldRunAdminSearch('a')).toBe(false)
    expect(shouldRunAdminSearch('ab')).toBe(false)
  })

  it('starts searching once the 3rd real character is typed', () => {
    expect(shouldRunAdminSearch('abc')).toBe(true)
    expect(shouldRunAdminSearch('abcd')).toBe(true)
  })

  it('ignores leading/trailing whitespace when counting characters', () => {
    // Two real characters padded with spaces still isn't enough...
    expect(shouldRunAdminSearch('  a  ')).toBe(false)
    // ...but three real characters is, even with padding around them.
    expect(shouldRunAdminSearch('  abc  ')).toBe(true)
  })
})
