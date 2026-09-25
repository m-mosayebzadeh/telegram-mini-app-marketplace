import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

/**
 * Where you are standing, written on the sky itself.
 *
 * The world used to run edge to edge with one object floating at the
 * bottom, which read as unfinished however coherent it was: a screen with
 * no top has nothing to sit inside. This gives it a top without giving it
 * a title bar (TECHNICAL_REQUIREMENTS.md section 29.8).
 *
 * Three rules it has to keep, and each of them is a thing it must NOT be:
 *
 * - **Not a bar.** No background, no line, no button of any kind. The
 *   moment something in here can be pressed there are two navigation
 *   systems on one screen, which is exactly what was rejected when the
 *   idea of a bottom tab bar came up.
 * - **Not decoration.** A fixed title is dead weight after the first
 *   glance. This answers "where am I and how much of it is there", and
 *   the answer changes as the world does.
 * - **Not in the way.** While the world is being dragged, attention
 *   belongs to the world; the text steps back to almost nothing and comes
 *   home when the hand stops.
 *
 * The first line is the galaxy you are standing in. There is only one so
 * far, because placing people by location has not been built yet — but it
 * is named here rather than described, so that when there are many, this
 * line already says the right kind of thing and only its value changes.
 *
 * Galaxy names are English and are not translated; the local spelling
 * follows in brackets (section 22).
 *
 * Arriving in a galaxy is an EVENT, so the name behaves like one: it
 * falls into place from above. That motion is the only thing on this
 * screen that says "you have travelled", and without it moving between
 * galaxies would be a silent text swap.
 */

export interface SkyHeaderProps {
  /** The galaxy this sky belongs to. One for now. */
  galaxy?: string
  /** How many people the sky is showing. */
  around: number
  /** How many of them are here at this moment. */
  present: number
}

export function SkyHeader({ galaxy = 'Vega', around, present }: SkyHeaderProps) {
  const { t, i18n } = useTranslation()

  // Formatted through the locale so Persian digits are Persian digits,
  // the same as everywhere else numbers are shown.
  const number = (value: number) => value.toLocaleString(i18n.language)
  const local = t('sky.galaxyLocal', { name: galaxy })

  /**
   * Replayed every time the name changes.
   *
   * A CSS animation runs once per element, so changing the text inside
   * the same element would simply swap it. Bumping a key remounts the
   * line, which is what makes the fall happen again — and it plays on the
   * first appearance too, because arriving in the world for the first
   * time is also an arrival.
   */
  const [arrival, setArrival] = useState(0)
  const previous = useRef<string | null>(null)
  useEffect(() => {
    if (previous.current !== galaxy) {
      previous.current = galaxy
      setArrival((count) => count + 1)
    }
  }, [galaxy])

  return (
    <header className="cos-header" data-chrome>
      <span className="cos-header-place" key={arrival}>
        <b className="cos-header-name cos-en">
          {galaxy} {t('sky.galaxyWord')}
        </b>
        {/* The local spelling, and only where there is one worth showing:
            in English the name IS the English name, so a bracket
            repeating it would be noise. */}
        {local && <i className="cos-header-local">({local})</i>}
      </span>
      <span className="cos-header-count">
        {t('sky.peopleAround', { count: around, n: number(around) })}
        {present > 0 && (
          <>
            <i className="cos-header-sep" aria-hidden="true" />
            {/* The live number carries the one green this app has, the
                same green as the ring around a person who is here. Two
                places, one meaning — which is what makes the header part
                of the world's vocabulary rather than a caption on top of
                it. */}
            <em className="cos-header-live">
              {t('sky.hereNowCount', { count: present, n: number(present) })}
            </em>
          </>
        )}
      </span>
    </header>
  )
}
