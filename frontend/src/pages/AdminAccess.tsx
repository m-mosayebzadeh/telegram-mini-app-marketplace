import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { createAdminGrant, deleteAdminGrant, listAdminGrants } from '../lib/adminApi'
import { formatApiError } from '../lib/api'
import { NumberField } from '../components/NumberField'
import { useMe } from '../lib/MeContext'
import type { AdminGrant } from '../lib/types'

// Every grantable scope, "section.subsection" (see the AdminGrant model's
// docstring for the naming convention), paired with its translation key
// (i18next keys can't contain literal dots, hence the separate map
// instead of building the key from the scope string itself) — add a row
// here whenever a new admin subsection becomes independently grantable.
// A full table/matrix UI for this is planned once there are enough
// scopes to justify it (see TECHNICAL_REQUIREMENTS.md's phase-2 notes);
// this checkbox list is the simple version until then.
const AVAILABLE_SCOPES: { scope: string; labelKey: string }[] = [
  { scope: 'finance.topups', labelKey: 'admin.grantScopeTopups' },
  { scope: 'finance.rates', labelKey: 'admin.grantScopeRates' },
]

/** "دسترسی‌ها" section — owner-only: granting/revoking subsection
 * scopes to someone else. See backend/app/admin/router.py's grant
 * endpoints (require_owner). */
export default function AdminAccess() {
  const { t } = useTranslation()
  const { adminAccess } = useMe()
  const [grants, setGrants] = useState<AdminGrant[] | null>(null)
  const [telegramId, setTelegramId] = useState('')
  const [scopes, setScopes] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (adminAccess?.is_owner) listAdminGrants().then(setGrants).catch(() => setGrants([]))
  }, [adminAccess])

  function toggleScope(scope: string) {
    setScopes((prev) => (prev.includes(scope) ? prev.filter((s) => s !== scope) : [...prev, scope]))
  }

  async function submit() {
    const id = Number(telegramId)
    if (!id || scopes.length === 0) return
    setError(null)
    try {
      await createAdminGrant(id, scopes)
      setTelegramId('')
      setScopes([])
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
      <div className="hp-field">
        <span className="hp-field-label">{t('admin.grantScopesLabel')}</span>
        <div className="hp-list">
          {AVAILABLE_SCOPES.map(({ scope, labelKey }) => (
            <label key={scope} className="hp-list-row">
              <span className="hp-list-title">{t(labelKey)}</span>
              <input type="checkbox" checked={scopes.includes(scope)} onChange={() => toggleScope(scope)} />
            </label>
          ))}
        </div>
      </div>
      {error && <p className="hp-error" style={{ margin: '0 12px' }}>{error}</p>}
      <div className="hp-field">
        <button
          className="hp-btn hp-btn-gradient"
          style={{ width: 'calc(100% - 24px)', margin: '0 12px' }}
          disabled={!telegramId || scopes.length === 0}
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
