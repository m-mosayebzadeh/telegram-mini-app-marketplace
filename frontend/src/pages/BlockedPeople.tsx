import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useToast } from '../components/ui'
import { QuietEmpty, QuietError, QuietPage, QuietSection, QuietWaiting } from '../components/cosmos/Quiet'
import { formatApiError } from '../lib/api'
import { fetchBlocked, unblockPerson, type BlockedPerson } from '../lib/accountApi'

/**
 * The people you blocked, and a way to let each one back (section 32,
 * step 4; drawn as the approved prototype, section 42). Only yours: a
 * block is never shown to anybody else, the blocked person included.
 */
export default function BlockedPeople() {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const toast = useToast()
  const [people, setPeople] = useState<BlockedPerson[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<number | null>(null)

  const load = useCallback(() => {
    fetchBlocked()
      .then((value) => {
        // Cleared on the answer, not before asking (a synchronous clear in the effect rendered twice).
        setError(null)
        setPeople(value)
      })
      .catch((err) => setError(formatApiError(err)))
  }, [])
  useEffect(load, [load])

  async function unblock(person: BlockedPerson) {
    setBusy(person.user_id)
    try {
      await unblockPerson(person.user_id)
      setPeople((list) => (list ?? []).filter((p) => p.user_id !== person.user_id))
      toast.success(t('blocked.unblocked', { name: person.display_name }))
    } catch (err) {
      toast.error(formatApiError(err))
    } finally {
      setBusy(null)
    }
  }

  // "3 Mehr" in Persian, "3 October" in English: the calendar of the
  // language being read.
  const since = (iso: string) =>
    new Date(iso).toLocaleDateString(i18n.language.startsWith('fa') ? 'fa-IR-u-ca-persian' : i18n.language, { day: 'numeric', month: 'long' })

  return (
    <QuietPage title={t('settings.blocked')} onBack={() => navigate(-1)}>
      {error ? (
        <QuietError text={error} onRetry={load} />
      ) : people === null ? (
        <QuietWaiting />
      ) : people.length === 0 ? (
        <QuietEmpty title={t('blocked.empty')} text={t('blocked.emptyHint')} />
      ) : (
        <>
          <p className="cos-q-lead">{t('blocked.lead')}</p>
          <QuietSection>
            <div className="cos-q-rows">
              {people.map((person) => (
                <div key={person.user_id} className="cos-q-person">
                  <span className="cos-q-face">
                    {person.avatar_url ? <img src={person.avatar_url} alt="" /> : person.display_name.slice(0, 1)}
                  </span>
                  <span className="cos-q-txt">
                    <span className="cos-q-t">{person.display_name}</span>
                    <span className="cos-q-h">{t('blocked.since', { date: since(person.blocked_at) })}</span>
                  </span>
                  <button type="button" className="cos-q-quiet" disabled={busy === person.user_id} onClick={() => void unblock(person)}>
                    {t('blocked.remove')}
                  </button>
                </div>
              ))}
            </div>
          </QuietSection>
        </>
      )}
    </QuietPage>
  )
}
