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
 * worried does not have to go looking through Settings. A session already
 * closed (by this button earlier, or from the devices list) says so instead
 * of failing. Closing this very device's session signs it out, as it would
 * from the devices list.
 */
export function TeamAction({ action }: { action: string }) {
  const { t } = useTranslation()
  const [state, setState] = useState<'idle' | 'busy' | 'closed' | 'failed'>('idle')
  const [kind, id] = action.split(':')
  const sessionId = Number(id)
  if (kind !== 'close_session' || !Number.isInteger(sessionId)) return null

  async function close() {
    setState('busy')
    try {
      await closeSession(sessionId)
      setState('closed')
    } catch (err) {
      // Not there any more: closed already, which is what was wanted.
      setState(err instanceof ApiError && err.status === 404 ? 'closed' : 'failed')
    }
  }

  if (state === 'closed') return <p className="cos-team-done" role="status">{t('team.closed')}</p>
  return (
    <button type="button" className="cos-team-action" disabled={state === 'busy'} onClick={() => void close()} data-control>
      {state === 'failed' ? t('team.tryAgain') : t('team.closeSession')}
    </button>
  )
}
