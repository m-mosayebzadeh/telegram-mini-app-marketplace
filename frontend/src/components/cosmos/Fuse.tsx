import { useEffect, useRef, useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'

/**
 * A fuse: time running out, drawn as a cord of warm light that burns down
 * with an ember at its tip (TECHNICAL_REQUIREMENTS.md section 16).
 *
 * Used for the payment window — once the offerer confirms, the requester has
 * a limited time to pay — wherever that wait is visible: the request card in
 * the conversation and the news. (An arc under the face on the stair was
 * tried and taken out: the owner did not like it; the stair row counts down
 * in words instead.)
 *
 * Deliberately NOT the session clock. The clock on a face FILLS as paid time
 * is used; a fuse BURNS AWAY as a chance runs out. Two different things, two
 * different shapes, so neither is mistaken for the other. And never red: red
 * already means "news for you" and "danger". In its last minute the ember
 * flickers faster instead — urgency carried by motion, not by colour.
 *
 * Time comes from one shared second-ticker for the whole app, so ten fuses on
 * screen are one timer, not ten. Each fuse only rewrites two CSS variables a
 * second; the burning itself is a CSS transition.
 */

// --------------------------------------------------------- shared ticker

let now = Date.now()
const listeners = new Set<() => void>()
let timer: number | undefined

function subscribe(listener: () => void) {
  listeners.add(listener)
  if (timer === undefined) {
    timer = window.setInterval(() => {
      now = Date.now()
      for (const l of listeners) l()
    }, 1000)
  }
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0 && timer !== undefined) {
      window.clearInterval(timer)
      timer = undefined
    }
  }
}

/** The current time, updated once a second, shared by every caller. */
export function useSecond(): number {
  return useSyncExternalStore(subscribe, () => now, () => now)
}

// ------------------------------------------------------------ the maths

/** Milliseconds left until `deadline`, never below zero. */
export function msLeft(deadline: string, at: number): number {
  return Math.max(0, Date.parse(deadline) - at)
}

/** m:ss in the reader's own digits; h:mm:ss past an hour. */
export function clockText(ms: number, language: string): string {
  const total = Math.ceil(ms / 1000)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const n = (v: number, pad = 1) => v.toLocaleString(language, { minimumIntegerDigits: pad, useGrouping: false })
  return h > 0 ? `${n(h)}:${n(m, 2)}:${n(s, 2)}` : `${n(m)}:${n(s, 2)}`
}

/** How much of the cord is left, 0..1, or null when the start is unknown. */
export function cordLeft(deadline: string, start: string | null | undefined, at: number): number | null {
  if (!start) return null
  const whole = Date.parse(deadline) - Date.parse(start)
  if (!(whole > 0)) return null
  return Math.min(1, Math.max(0, msLeft(deadline, at) / whole))
}

/** Calls `onDone` once, the first time `left` reaches zero. */
function useWhenDone(left: number, onDone?: () => void) {
  const fired = useRef(false)
  useEffect(() => {
    if (left > 0) {
      fired.current = false
      return
    }
    if (!fired.current) {
      fired.current = true
      onDone?.()
    }
  }, [left, onDone])
}

// ---------------------------------------------------------- the drawings

interface FuseProps {
  /** When the time runs out. */
  deadline: string
  /** When it started, for how much cord is left. Without it only the time
   *  is shown and the ember glows on its own. */
  start?: string | null
  /** The sentence around the time: gets {{time}}. */
  label: string
  /** Read the state again at zero — which is also what closes the window
   *  on the server and tells the other person. */
  onDone?: () => void
  className?: string
}

/** The fuse as a line under a card, with the time written beside it. */
export function Fuse({ deadline, start, label, onDone, className = '' }: FuseProps) {
  const { t, i18n } = useTranslation()
  const at = useSecond()
  const left = msLeft(deadline, at)
  const cord = cordLeft(deadline, start, at)
  useWhenDone(left, onDone)
  const style = { '--cord': cord ?? 1 } as React.CSSProperties
  return (
    <span
      className={`cos-fuse${left < 60_000 ? ' is-last' : ''}${cord === null ? ' is-open' : ''}${left === 0 ? ' is-out' : ''} ${className}`}
      style={style}
      role="timer"
      aria-live="off"
    >
      <span className="cos-fuse-text">{t(label, { time: clockText(left, i18n.language) })}</span>
      <span className="cos-fuse-line" aria-hidden="true">
        <span className="cos-fuse-cord" />
        <span className="cos-fuse-ember" />
      </span>
    </span>
  )
}

/** Just the time left, as words — for a line of text that has no room for
 *  a cord (the news cards keep one fixed height). */
export function Countdown({ deadline, label, values, onDone }: { deadline: string; label: string; values?: Record<string, string>; onDone?: () => void }) {
  const { t, i18n } = useTranslation()
  const at = useSecond()
  const left = msLeft(deadline, at)
  useWhenDone(left, onDone)
  return <>{t(label, { ...values, time: clockText(left, i18n.language) })}</>
}

/**
 * The fuse as the card's own lower edge: the border itself burns away,
 * ember first. Drawn over the card, so the card keeps its size.
 */
export function EdgeFuse({ deadline, start }: { deadline: string; start?: string | null }) {
  const at = useSecond()
  const left = msLeft(deadline, at)
  const cord = cordLeft(deadline, start, at)
  if (cord === null) return null
  return (
    <span
      className={`cos-edge-fuse${left < 60_000 ? ' is-last' : ''}`}
      style={{ '--cord': cord } as React.CSSProperties}
      aria-hidden="true"
    >
      <span className="cos-fuse-cord" />
      <span className="cos-fuse-ember" />
    </span>
  )
}

interface BurningButtonProps {
  deadline: string
  start?: string | null
  /** What the button says (or, passive, what is being waited for). */
  label: string
  /** The countdown line under it: gets {{time}}. */
  timeLabel: string
  onClick?: () => void
  disabled?: boolean
  /** The other side's view: the same burning pill, but nothing to press. */
  passive?: boolean
  onDone?: () => void
}

/**
 * The payment button as the fuse itself (the owner's choice over a
 * separate line, TECHNICAL_REQUIREMENTS.md section 30.20).
 *
 * The button's warmth is a charge that drains from its far end as the
 * window runs out. Behind it is cooling coal, still faintly warm; on the
 * boundary a bright burning edge throws off a few sparks. The label is
 * drawn twice — dark on the warmth, light on the coal — and the seam
 * between the two rides the burning edge, so the words stay readable
 * everywhere. The time left is written underneath. In the last minute the
 * edge flickers faster and the whole button breathes; never red.
 *
 * The drain is two CSS variables written once a second by the shared
 * ticker; everything between seconds is transitions and keyframes.
 */
export function BurningButton({ deadline, start, label, timeLabel, onClick, disabled, passive, onDone }: BurningButtonProps) {
  const { t, i18n } = useTranslation()
  const at = useSecond()
  const left = msLeft(deadline, at)
  const cord = cordLeft(deadline, start, at) ?? (left > 0 ? 1 : 0)
  useWhenDone(left, onDone)
  const out = left === 0
  const className = [
    'cos-burn-btn',
    passive && 'is-passive',
    left < 60_000 && !out && 'is-last',
    out && 'is-out',
  ].filter(Boolean).join(' ')
  const style = { '--cord': cord.toFixed(4) } as React.CSSProperties
  const inner = (
    <>
      <span className="cos-burn-coal" aria-hidden="true" />
      <span className="cos-burn-fill" aria-hidden="true" />
      <span className="cos-burn-label is-dark" aria-hidden="true">{label}</span>
      <span className="cos-burn-label is-light" aria-hidden="true">{label}</span>
      {!out && (
        <span className="cos-burn-edge" aria-hidden="true">
          <i />
          <i />
          <i />
          <i />
        </span>
      )}
    </>
  )
  return (
    <div className="cos-burn">
      {passive ? (
        <div className={className} style={style} role="img" aria-label={label}>
          {inner}
        </div>
      ) : (
        <button type="button" className={className} style={style} onClick={onClick} disabled={disabled || out} aria-label={label}>
          {inner}
        </button>
      )}
      <span className="cos-burn-time" role="timer">
        {t(timeLabel, { time: clockText(left, i18n.language) })}
      </span>
    </div>
  )
}
