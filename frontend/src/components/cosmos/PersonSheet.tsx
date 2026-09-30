import { useTranslation } from 'react-i18next'
import type { ReactNode } from 'react'

/**
 * Somebody you tapped in the world, from the bottom of the screen
 * (TECHNICAL_REQUIREMENTS.md section 32).
 *
 * Who they are — their face, name, whether they are here now, their own
 * line — and the two things to do, in the thumb's reach: say hello, or see
 * their profile. A tap on the dark around it lets them go. It replaces the
 * label floating under the held person and the two loose buttons, which
 * together asked a newcomer to read the world before they could act in it.
 */

interface PersonSheetProps {
  name: string
  /** Their face, as the world draws it. */
  face: ReactNode
  online: boolean
  line: string | null
  /** Short flags that matter right now: news for you, a session running. */
  flags?: string[]
  /** "Say hello", or "back to the session" with somebody you are in one with. */
  sayLabel: string
  /** Shown instead of saying hello when the day's budget for new people ran out. */
  limit?: string | null
  onSay: () => void
  onProfile: () => void
  onClose: () => void
}

export function PersonSheet({ name, face, online, line, flags = [], sayLabel, limit, onSay, onProfile, onClose }: PersonSheetProps) {
  const { t } = useTranslation()
  return (
    <div className="cos-person" data-chrome>
      <button type="button" className="cos-person-veil" aria-label={t('sheet.close')} onClick={onClose} />
      <div className="cos-person-sheet" role="dialog" aria-label={name}>
        <span className="cos-person-grab" aria-hidden="true" />
        <span className="cos-person-face">{face}</span>
        <h2 className="cos-person-name">{name}</h2>
        {online && <span className="cos-person-flag is-live">{t('sky.hereNow')}</span>}
        {flags.map((flag) => (
          <span key={flag} className="cos-person-flag">{flag}</span>
        ))}
        {line && <p className="cos-person-line">{line}</p>}
        {limit && <p className="cos-person-limit" role="status">{limit}</p>}
        <button type="button" className="cos-person-say" onClick={onSay}>{sayLabel}</button>
        <button type="button" className="cos-person-see" onClick={onProfile}>{t('sky.viewProfile')}</button>
      </div>
    </div>
  )
}
