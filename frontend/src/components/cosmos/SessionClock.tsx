import { useEffect, useState } from 'react'
import type { ChatSession } from '../../lib/types'

/**
 * A running paid session's clock, drawn ON the person's face.
 *
 * The spent part of the session warms the face like light moving across a
 * sundial; one bright hand marks "now"; small notches at the edge are the
 * blocks. Nothing is drawn around the face, because a ring around a body
 * already means "here right now", and nothing crosses it, because a face
 * cut into quarters stops being a face (TECHNICAL_REQUIREMENTS.md sections
 * 30.13 and 30.14). Only the two people in the session are ever shown it.
 *
 * Place it inside whatever holds the face; it fills its parent.
 */

/** How far through the session we are, 0..1, and how many blocks it has. */
export function sessionProgress(session: ChatSession, now: number = Date.now()): { spent: number; blocks: number } | null {
  if (!session.started_at || !session.ends_at) return null
  const start = new Date(session.started_at).getTime()
  const end = new Date(session.ends_at).getTime()
  if (end <= start) return null
  const blocks = Math.max(1, session.reserved_blocks || Math.round((end - start) / (session.block_duration_seconds * 1000)))
  return { spent: Math.min(1, Math.max(0, (now - start) / (end - start))), blocks }
}

export function SessionClock({ session }: { session: ChatSession }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    // Once a second is plenty for a clock whose smallest unit is minutes,
    // and it touches two style properties, nothing else.
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])
  const progress = sessionProgress(session, now)
  if (!progress) return null
  const style = {
    '--a': `${(progress.spent * 360).toFixed(1)}deg`,
    '--step': `${(360 / progress.blocks).toFixed(2)}deg`,
  } as React.CSSProperties
  return (
    <span className="cos-clock" style={style} aria-hidden="true">
      <span className="cos-clock-spent" />
      <span className="cos-clock-ticks" />
      <span className="cos-clock-hand" />
    </span>
  )
}
