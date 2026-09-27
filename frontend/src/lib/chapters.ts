/**
 * One conversation, told in chapters (TECHNICAL_REQUIREMENTS.md section
 * 30.9, and the approved prototype).
 *
 * Talking freely and a paid session are both part of the one thread with a
 * person. What changes is how they are drawn: free talk is plain, with a
 * small date where a new day begins; a paid session is a warm band holding
 * its own messages, with what it was at the top and how it ended at the
 * bottom — so where it began and ended can be seen while scrolling, with
 * no legend.
 *
 * Pure, so the grouping is tested on its own (chapters.test.ts).
 */

export interface Chaptered {
  chat_session_id?: number | null
  created_at: string
}

export type Chapter<M> =
  | { kind: 'free'; messages: Array<{ message: M; newDay: boolean }> }
  | { kind: 'session'; sessionId: number; messages: M[] }

/** The calendar day a message belongs to, where the reader is. */
function dayOf(iso: string): string {
  const d = new Date(iso)
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
}

export function chaptersOf<M extends Chaptered>(messages: M[]): Array<Chapter<M>> {
  const out: Array<Chapter<M>> = []
  let lastDay: string | null = null
  for (const message of messages) {
    const sessionId = message.chat_session_id ?? null
    const current = out[out.length - 1]
    const day = dayOf(message.created_at)
    if (sessionId !== null) {
      if (current?.kind === 'session' && current.sessionId === sessionId) current.messages.push(message)
      else out.push({ kind: 'session', sessionId, messages: [message] })
    } else {
      // A date where a new day begins — and again after a session, whose
      // band carries its own date, so the talk that follows is placed too.
      const newDay = day !== lastDay || current?.kind === 'session'
      if (current?.kind === 'free') current.messages.push({ message, newDay })
      else out.push({ kind: 'free', messages: [{ message, newDay }] })
    }
    lastDay = day
  }
  return out
}
