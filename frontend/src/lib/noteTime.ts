/**
 * The small line under a note of the day: when it was written
 * (TECHNICAL_REQUIREMENTS.md section 32, the owner's decision — "the hour
 * it was written, in small letters under it, not as an explanation").
 *
 * A note lives one day, so the hour is enough, with "yesterday" when it
 * was written before midnight. Always on the reader's own clock: nine in
 * the morning in Tehran is not nine in Toronto, and the reader wants to
 * know how long ago it was, not what the writer's clock said.
 */

export interface NoteTime {
  /** The i18n key: note.writtenAt or note.writtenYesterday. */
  key: 'note.writtenAt' | 'note.writtenYesterday'
  /** The hour, already in the reader's language and clock. */
  time: string
}

export function noteTime(writtenAt: string | null | undefined, language: string, now: Date = new Date()): NoteTime | null {
  if (!writtenAt) return null
  const at = new Date(writtenAt)
  if (Number.isNaN(at.getTime())) return null
  const time = at.toLocaleTimeString(language, { hour: 'numeric', minute: '2-digit' })
  const sameDay = at.getFullYear() === now.getFullYear() && at.getMonth() === now.getMonth() && at.getDate() === now.getDate()
  return { key: sameDay ? 'note.writtenAt' : 'note.writtenYesterday', time }
}
