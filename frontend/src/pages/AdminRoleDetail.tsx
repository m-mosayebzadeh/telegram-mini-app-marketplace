import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Input, Placeholder, Spinner } from '@telegram-apps/telegram-ui'
import { createRole, getRole, updateRole } from '../lib/adminApi'
import { formatApiError } from '../lib/api'
import { IconArrowNarrowLeft } from '../components/icons'

// Every grantable scope, "section.subsection" (see the Role model's
// docstring for the naming convention), paired with its translation key
// (i18next keys can't contain literal dots, hence the separate map
// instead of building the key from the scope string itself) — add a row
// here whenever a new admin subsection becomes independently grantable.
const AVAILABLE_SCOPES: { scope: string; labelKey: string }[] = [
  { scope: 'finance.topups', labelKey: 'admin.scopeFinanceTopups' },
  { scope: 'finance.rates', labelKey: 'admin.scopeFinanceRates' },
]

/**
 * Doubles as both "ایجاد نقش" (id === "new") and the edit page a role
 * row opens into (rename + add/remove scopes) — also reused, read-only
 * in spirit but not actually locked, as the "نمایش دسترسی‌های نقش"
 * destination from a user's own role list (AdminUserRoles.tsx), since
 * only the owner ever reaches either path anyway.
 */
export default function AdminRoleDetail() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { id } = useParams()
  const isNew = id === 'new'
  const roleId = isNew ? null : Number(id)

  const [name, setName] = useState('')
  const [scopes, setScopes] = useState<string[]>([])
  const [loaded, setLoaded] = useState(isNew)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (roleId == null) return
    getRole(roleId)
      .then((role) => {
        setName(role.name)
        setScopes(role.scopes)
        setLoaded(true)
      })
      .catch((err) => setError(formatApiError(err)))
  }, [roleId])

  function toggleScope(scope: string) {
    setScopes((prev) => (prev.includes(scope) ? prev.filter((s) => s !== scope) : [...prev, scope]))
  }

  async function save() {
    if (!name.trim()) {
      setError(t('admin.roleNameRequired'))
      return
    }
    setBusy(true)
    setError(null)
    try {
      if (isNew) {
        await createRole(name.trim(), scopes)
      } else if (roleId != null) {
        await updateRole(roleId, { name: name.trim(), scopes })
      }
      navigate('/admin/assistants/roles')
    } catch (err) {
      setError(formatApiError(err))
    } finally {
      setBusy(false)
    }
  }

  if (!loaded) {
    return (
      <Placeholder>
        <Spinner size="l" />
      </Placeholder>
    )
  }

  return (
    <div className="hp-page">
      <div className="hp-page-back-header">
        <button className="hp-chat-back" onClick={() => navigate(-1)} aria-label={t('common.back')}>
          <IconArrowNarrowLeft size={20} />
        </button>
        <span className="hp-page-back-title">{t(isNew ? 'admin.createRoleTitle' : 'admin.editRoleTitle')}</span>
      </div>

      <div className="hp-field">
        <Input header={t('admin.roleNameLabel')} value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="hp-field">
        <span className="hp-field-label">{t('admin.roleScopesLabel')}</span>
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
        <button className="hp-btn hp-btn-gradient" style={{ width: '100%' }} disabled={busy} onClick={save}>
          {busy ? t('common.loading') : t('common.submit')}
        </button>
      </div>
    </div>
  )
}
