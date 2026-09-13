import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ChatSession } from '../../lib/types'

/**
 * Where you are in a session, above the conversation.
 *
 * Four things had to be true at once, and they pull against each other:
 * it has to say how much time is left, it has to sit directly above an
 * intimate conversation without competing with it, it has to be readable
 * at a glance mid-sentence, and it must not run an animation for half an
 * hour on someone's battery.
 *
 * So it is a row of segments, one per reserved block, and nothing moves
 * except once every block — a segment fills, and the figures change. The
 * "filling with fire" idea was dropped: a flame is a thing you look AT,
 * and this sits above a conversation that is the actual subject.
 *
 * The remaining TIME is the headline and the money is not on the bar at
 * all — a figure that climbs during an intimate conversation reads as a
 * taxi meter, which is directly against what this product is. The amount
 * appears for four seconds as each block turns over (see AMOUNT_REVEAL_MS
 * below), and otherwise lives in the details panel.
 */

/**
 * How long the consumed amount stays on screen when a block turns over.
 *
 * Two seconds was tried and is too short: in that time the eye has to
 * notice something changed, find it, and read it. Four is long enough to
 * register and short enough that it is an event rather than a readout —
 * which is the whole difference between this and a meter.
 */
const AMOUNT_REVEAL_MS = 4000

interface BlockBarProps {
  session: ChatSession
  /** Opens the details panel, where the money lives permanently. */
  onOpenDetails: () => void
}

export function BlockBar({ session, onOpenDetails }: BlockBarProps) {
  const { t } = useTranslation()
  const now = useNow(session.status === 'open')

  const started = session.started_at ? Date.parse(session.started_at) : null
  const blockMs = session.block_duration_seconds * 1000
  const endsAt = session.ends_at ? Date.parse(session.ends_at) : null

  // Blocks advance on wall-clock time, not on who is connected — which is
  // the decision that lets this be arithmetic rather than a subscription.
  const elapsed = started == null ? 0 : Math.max(0, now - started)
  const consumed =
    session.status === 'closed'
      ? session.consumed_blocks
      : Math.min(session.reserved_blocks, Math.floor(elapsed / blockMs))
  const remainingMs = endsAt == null ? null : Math.max(0, endsAt - now)

  const amount = useAmountOnBlockChange(consumed, session.block_price_drops)

  const waiting = started == null && session.status === 'open'

  return (
    <button
      type="button"
      className="bb"
      onClick={onOpenDetails}
      aria-label={t('chatSession.sessionProgress')}
    >
      <span className="bb-track" aria-hidden="true">
        {Array.from({ length: session.reserved_blocks }, (_, index) => (
          <span
            key={index}
            className={
              'bb-block' +
              (index < consumed ? ' bb-block-spent' : '') +
              // Only the block actually running is marked, and only while
              // the session is live.
              (index === consumed && !waiting && session.status === 'open'
                ? ' bb-block-live'
                : '')
            }
          />
        ))}
      </span>

      <span className="bb-line">
        <span className="bb-time tabular">
          {waiting
            ? t('chatSession.notStartedShort')
            : remainingMs == null
              ? ''
              : t('chatSession.remaining', { minutes: Math.ceil(remainingMs / 60000) })}
        </span>

        {/* Shown only as a block turns over, then gone. */}
        {amount != null && (
          <span className="bb-amount tabular" role="status">
            {t('chatSession.spentSoFar', { drops: amount })}
          </span>
        )}
      </span>
    </button>
  )
}

/**
 * A clock that ticks only while it is worth ticking.
 *
 * Once a second, and never at all on a closed session — the bar on an
 * archived conversation is a still picture of where it stopped.
 */
function useNow(live: boolean): number {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (!live) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [live])

  return now
}

/**
 * The consumed amount, but only for a moment after it changes.
 *
 * Returns null the rest of the time, which is what keeps the bar from
 * being a meter. The first value a session renders with does NOT count
 * as a change — reopening a conversation mid-way should not flash a
 * number at someone who did not just cross a block.
 */
function useAmountOnBlockChange(consumedBlocks: number, pricePerBlock: number): number | null {
  const [amount, setAmount] = useState<number | null>(null)
  const previous = useRef<number | null>(null)

  useEffect(() => {
    const first = previous.current === null
    const changed = !first && consumedBlocks !== previous.current
    previous.current = consumedBlocks
    if (!changed || consumedBlocks === 0) return

    setAmount(consumedBlocks * pricePerBlock)
    const id = setTimeout(() => setAmount(null), AMOUNT_REVEAL_MS)
    return () => clearTimeout(id)
  }, [consumedBlocks, pricePerBlock])

  return amount
}
