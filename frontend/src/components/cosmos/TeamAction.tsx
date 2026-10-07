import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ApiError } from '../../lib/api'
import { closeSession } from '../../lib/sessionsApi'

/**
 * What a Cosmos Team message offers to do (TECHNICAL_REQUIREMENTS.md
 * section 37), under its words.
 *
 * Today one thing: "a new sign-in to your account — if it wasn't you, close
 * this session", with the button that closes it right there, so somebody
 * worried does not have to go looking through Settings.
 *
 * No button where it would do nothing or harm (section 40): a session
 * already closed — by this button, from the devices list, or by ninety
 * days unused — says "no longer open" from the start, however old the
 * message; a note about this very device says so, rather than offering to
 * sign it out. Closing only ever works on the person's own sessions; the
 * server checks that.
 */
export function TeamAction({ action, open, hereSession }: { action: string; open?: boolean | null; hereSession?: number | null }) {
  const { t } = useTranslation()
  const [state, setState] = useState<'idle' | 'busy' | 'closed' | 'gone' | 'failed'>('idle')
  const [kind, id] = action.split(':')
  const sessionId = Number(id)
  if (kind !== 'close_session' || !Number.isInteger(sessionId)) return null
  if (sessionId === hereSession) return <p className="cos-team-done">{t('team.thisDevice')}</p>
  if (open === false && state === 'idle') return <p className="cos-team-done">{t('team.notOpen')}</p>

  async function close() {
    setState('busy')
    try {
      await closeSession(sessionId)
      setState('closed')
    } catch (err) {
      // Not there any more: closed meanwhile, which is what was wanted.
      setState(err instanceof ApiError && err.status === 404 ? 'gone' : 'failed')
    }
  }

  if (state === 'closed') return <p className="cos-team-done" role="status">{t('team.closed')}</p>
  if (state === 'gone') return <p className="cos-team-done" role="status">{t('team.notOpen')}</p>
  return (
    <button type="button" className="cos-team-action" disabled={state === 'busy'} onClick={() => void close()} data-control>
      {state === 'failed' ? t('team.tryAgain') : t('team.closeSession')}
    </button>
  )
}
