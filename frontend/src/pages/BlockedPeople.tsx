import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { EmptyState, ErrorState, PageHeader, SkeletonRows, useToast } from '../components/ui'
import { IconShieldLock } from '../components/icons'
import { formatApiError } from '../lib/api'
import { fetchBlocked, unblockPerson, type BlockedPerson } from '../lib/accountApi'

/**
 * The people you blocked, and a way to let each one back (section 32,
 * step 4). Only yours: a block is never shown to anybody else, the
 * blocked person included.
 */
export default function BlockedPeople() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const toast = useToast()
  const [people, setPeople] = useState<BlockedPerson[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<number | null>(null)

  const load = useCallback(() => {
    setError(null)
    fetchBlocked()
      .then(setPeople)
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

  return (
    <div className="ui-page">
      <PageHeader title={t('settings.blocked')} onBack={() => navigate(-1)} />
      <div className="ui-page-body">
        {error ? (
          <ErrorState text={error} onRetry={load} />
        ) : people === null ? (
          <SkeletonRows count={3} />
        ) : people.length === 0 ? (
          <EmptyState icon={<IconShieldLock size={24} />} title={t('blocked.empty')} text={t('blocked.emptyHint')} />
        ) : (
          <div className="ui-list">
            {people.map((person) => (
              <div key={person.user_id} className="ui-row">
                <span className="ui-row-media st-face">
                  {person.avatar_url ? <img src={person.avatar_url} alt="" /> : person.display_name.slice(0, 1)}
                </span>
                <span className="ui-row-main">
                  <span className="ui-row-title">{person.display_name}</span>
                </span>
                <span className="ui-row-trailing">
                  <button
                    type="button"
                    className="ui-btn ui-btn-secondary ui-btn-sm"
                    disabled={busy === person.user_id}
                    onClick={() => void unblock(person)}
                  >
                    {t('blocked.unblock')}
                  </button>
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
