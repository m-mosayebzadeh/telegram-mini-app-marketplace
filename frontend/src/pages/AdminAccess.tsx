import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { createAdminGrant, deleteAdminGrant, listAdminGrants } from '../lib/adminApi'
import { formatApiError } from '../lib/api'
import { NumberField } from '../components/NumberField'
import { useMe } from '../lib/MeContext'
import type { AdminGrant } from '../lib/types'

/** "دسترسی‌ها" section — owner-only: granting/revoking a subsection
 * scope (e.g. "finance.topups") to someone else. See
 * backend/app/admin/router.py's grant endpoints (require_owner). */
export default function AdminAccess() {
  const { t } = useTranslation()
  const { adminAccess } = useMe()
  const [grants, setGrants] = useState<AdminGrant[] | null>(null)
  const [telegramId, setTelegramId] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (adminAccess?.is_owner) listAdminGrants().then(setGrants).catch(() => setGrants([]))
  }, [adminAccess])

  async function submit() {
    const id = Number(telegramId)
    if (!id) return
    setError(null)
    try {
      // finance.topups is the only subsection that exists today — see
      // the chat that led here for the "section.subsection" scope
      // naming convention this'll extend as more sections get built.
      await createAdminGrant(id, ['finance.topups'])
      setTelegramId('')
      listAdminGrants().then(setGrants)
    } catch (err) {
      setError(formatApiError(err))
    }
  }

  async function revoke(id: number) {
    await deleteAdminGrant(id)
    listAdminGrants().then(setGrants)
  }

  if (!adminAccess) return null
  if (!adminAccess.is_owner) return <div className="hp-page hp-empty">{t('admin.noAccess')}</div>

  return (
    <div className="hp-page">
      <div className="hp-page-header">{t('admin.sectionAccess')}</div>
      <div className="hp-field">
        <NumberField header={t('admin.grantTelegramIdLabel')} value={telegramId} onChange={setTelegramId} />
      </div>
      {error && <p className="hp-error" style={{ margin: '0 12px' }}>{error}</p>}
      <div className="hp-field">
        <button
          className="hp-btn hp-btn-gradient"
          style={{ width: 'calc(100% - 24px)', margin: '0 12px' }}
          disabled={!telegramId}
          onClick={submit}
        >
          {t('admin.grantSubmit')}
        </button>
      </div>
      {grants && grants.length > 0 && (
        <div className="hp-list">
          {grants.map((g) => (
            <div key={g.id} className="hp-list-row">
              <span className="hp-list-title">
                {g.display_name}
                {g.username ? ` (@${g.username})` : ''}
              </span>
              <button className="hp-btn-sm" onClick={() => revoke(g.id)}>
                {t('admin.grantRevoke')}
              </button>
            </div>
          ))}
        </div>
      )}
      {grants && grants.length === 0 && <p className="hp-empty">{t('admin.grantsEmpty')}</p>}
    </div>
  )
}
