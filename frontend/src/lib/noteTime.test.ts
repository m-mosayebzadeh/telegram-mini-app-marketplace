import { describe, expect, it } from 'vitest'
import { noteTime } from './noteTime'

/** The hour under a note (section 32): today, or yesterday, on your clock. */
describe('when a note was written', () => {
  const now = new Date(2026, 9, 3, 14, 0)

  it('says the hour when it was written today', () => {
    const at = new Date(2026, 9, 3, 9, 30)
    const said = noteTime(at.toISOString(), 'en', now)
    expect(said?.key).toBe('note.writtenAt')
    expect(said?.time).toMatch(/9:30/)
  })

  it('says yesterday when it was written before midnight', () => {
    const at = new Date(2026, 9, 2, 22, 10)
    expect(noteTime(at.toISOString(), 'en', now)?.key).toBe('note.writtenYesterday')
  })

  it('says nothing when there is no note, or the date is broken', () => {
    expect(noteTime(null, 'en', now)).toBeNull()
    expect(noteTime('not a date', 'en', now)).toBeNull()
  })
})
