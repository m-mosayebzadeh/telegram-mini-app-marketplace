import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

/**
 * How you get anywhere: hold the core, drag towards a section, let go.
 *
 * One continuous gesture rather than tap-then-tap
 * (TECHNICAL_REQUIREMENTS.md section 22). Your thumb is already on the
 * screen; asking it to land twice on two different targets is two chances
 * to miss.
 *
 * The arcs open only in the UPPER half. Below the core is partly off the
 * screen and entirely under the palm of the hand holding the phone, so a
 * full circle would put half its options where they cannot be seen or
 * reached. This is the same reason the actions panel is anchored to the
 * bottom rather than drawn around a floating orb.
 *
 * There is ONE label and it does not move. Four labels around a circle
 * means three of them are always upside down or sideways; instead the
 * label sits in a fixed place and its text changes as the finger travels.
 */

export interface CoreSection {
  id: string
  label: string
  onChoose: () => void
}

interface CoreNavProps {
  sections: CoreSection[]
}

/** How far the finger must travel before a section is picked at all.
 *  Below this, letting go means "never mind" — which is what makes the
 *  gesture safe to start by accident. */
const COMMIT_DISTANCE = 38

/** The arc the sections are spread across, in degrees, measured from the
 *  left of the core round the top to the right. */
const ARC_START = 200
const ARC_END = 340

export function CoreNav({ sections }: CoreNavProps) {
  const { t } = useTranslation()
  const [held, setHeld] = useState(false)
  const [hot, setHot] = useState<number | null>(null)
  const coreRef = useRef<HTMLDivElement>(null)
  const origin = useRef({ x: 0, y: 0 })

  function angleFor(index: number): number {
    if (sections.length === 1) return (ARC_START + ARC_END) / 2
    return ARC_START + (index * (ARC_END - ARC_START)) / (sections.length - 1)
  }

  function pick(clientX: number, clientY: number): number | null {
    const dx = clientX - origin.current.x
    const dy = clientY - origin.current.y
    if (Math.hypot(dx, dy) < COMMIT_DISTANCE) return null

    // Screen coordinates grow downwards, so "up" is a negative dy; the
    // negation here is what puts 270 degrees at the top where a person
    // would expect it.
    let degrees = (Math.atan2(-dy, dx) * 180) / Math.PI
    degrees = (360 - ((degrees + 360) % 360)) % 360

    let best: number | null = null
    let bestGap = 40
    sections.forEach((_, index) => {
      const gap = Math.abs(shortestAngle(degrees, angleFor(index)))
      if (gap < bestGap) {
        bestGap = gap
        best = index
      }
    })
    return best
  }

  function onPointerDown(event: React.PointerEvent) {
    event.stopPropagation()
    const box = coreRef.current?.getBoundingClientRect()
    if (!box) return
    origin.current = { x: box.left + box.width / 2, y: box.top + box.height / 2 }
    setHeld(true)
    setHot(null)
    coreRef.current?.setPointerCapture(event.pointerId)
  }

  function onPointerMove(event: React.PointerEvent) {
    if (!held) return
    event.stopPropagation()
    const next = pick(event.clientX, event.clientY)
    if (next !== hot) {
      setHot(next)
      // A small tick as the finger lands on each one, so the choice can
      // be felt without looking at it.
      if (next !== null) navigator.vibrate?.(8)
    }
  }

  function onPointerUp(event: React.PointerEvent) {
    if (!held) return
    event.stopPropagation()
    setHeld(false)
    const chosen = hot
    setHot(null)
    if (chosen !== null) {
      navigator.vibrate?.(14)
      sections[chosen].onChoose()
    }
  }

  return (
    <div className="cos-core-area" data-chrome>
      {held && (
        <div className="cos-core-arcs" aria-hidden="true">
          {sections.map((section, index) => {
            const degrees = angleFor(index)
            const radians = (degrees * Math.PI) / 180
            return (
              <span
                key={section.id}
                className={`cos-core-arc${hot === index ? ' is-hot' : ''}`}
                style={{
                  left: `${Math.cos(radians) * 84}px`,
                  top: `${-Math.sin(radians) * 84}px`,
                }}
              />
            )
          })}
        </div>
      )}

      {/* One label, in one place, whose text changes. */}
      {held && (
        <div className="cos-core-label">
          {hot === null ? t('sky.chooseHint') : sections[hot].label}
        </div>
      )}

      <div
        className={`cos-core${held ? ' is-held' : ''}`}
        ref={coreRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => {
          setHeld(false)
          setHot(null)
        }}
        role="button"
        aria-label={t('sky.chooseHint')}
      >
        <span className="cos-core-eye" />
      </div>
    </div>
  )
}

/** The signed distance between two angles, the short way round. Without
 *  it, 350 and 10 degrees look 340 apart instead of 20. */
function shortestAngle(a: number, b: number): number {
  return ((((a - b) % 360) + 540) % 360) - 180
}
