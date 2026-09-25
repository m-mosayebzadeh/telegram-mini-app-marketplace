import { useRef } from 'react'

/** Half a second, the owner's choice and Telegram's: long enough not to
 *  fire while scrolling, short enough that nobody lifts their finger
 *  thinking it did nothing. */
export const HOLD_MS = 500

/** A finger that moves further than this is scrolling, not holding. */
const MOVE_TOLERANCE = 10

/**
 * Tells a tap from a hold on one element, and both from a scroll.
 *
 * Returns handlers to spread onto the element. `onTap` fires on a short
 * press that did not move; `onHold` fires once the press has lasted
 * HOLD_MS; a finger that moves cancels both, so scrolling through a
 * conversation never opens anything.
 *
 * On a computer the right button opens the same thing as a tap would
 * (`onSecondary`). A phone also sends that event on a long press, and there
 * it must be ignored, or every hold would open the menu as well as select.
 */
export function useHold({
  onTap,
  onHold,
  onSecondary,
}: {
  onTap: (target: HTMLElement, pointerType: string) => void
  onHold: (target: HTMLElement) => void
  onSecondary: (target: HTMLElement) => void
}) {
  const timer = useRef<number | undefined>(undefined)
  const start = useRef<{ x: number; y: number } | null>(null)
  const held = useRef(false)
  /** The last press was a tap, waiting for its click. */
  const tapped = useRef(false)
  const lastPointer = useRef<string>('mouse')

  function cancel() {
    window.clearTimeout(timer.current)
    start.current = null
  }

  return {
    onPointerDown(event: React.PointerEvent<HTMLElement>) {
      lastPointer.current = event.pointerType
      // Only the main button; the right one is handled by onContextMenu.
      if (event.button !== 0) return
      const target = event.currentTarget
      held.current = false
      start.current = { x: event.clientX, y: event.clientY }
      timer.current = window.setTimeout(() => {
        held.current = true
        start.current = null
        // A short buzz where the phone allows it, so the finger feels that
        // something was picked up.
        navigator.vibrate?.(12)
        onHold(target)
      }, HOLD_MS)
    },
    onPointerMove(event: React.PointerEvent<HTMLElement>) {
      const from = start.current
      if (!from) return
      if (Math.hypot(event.clientX - from.x, event.clientY - from.y) > MOVE_TOLERANCE) cancel()
    },
    onPointerUp() {
      // Only noted here; the tap itself is acted on in onClick below.
      tapped.current = start.current !== null && !held.current
      cancel()
    },
    /**
     * The tap happens on click, not on the finger lifting.
     *
     * A phone sends its click a moment AFTER the finger lifts, to whatever
     * is under the finger by then. Opening a menu on the lift put the
     * menu's backdrop under the finger just in time to receive that click
     * — which closed the menu again before anybody saw it. That was the
     * menu that "did not open" on the phone. A mouse never showed it,
     * because a mouse's click goes to where the press began.
     */
    onClick(event: React.MouseEvent<HTMLElement>) {
      if (!tapped.current) return
      tapped.current = false
      // The element actually touched, so the caller can leave taps on a
      // play button or a photo to those controls.
      onTap(event.target as HTMLElement, lastPointer.current)
    },
    onPointerCancel: cancel,
    onPointerLeave: cancel,
    onContextMenu(event: React.MouseEvent<HTMLElement>) {
      event.preventDefault()
      if (lastPointer.current === 'touch' || lastPointer.current === 'pen') return
      cancel()
      onSecondary(event.currentTarget)
    },
  }
}
