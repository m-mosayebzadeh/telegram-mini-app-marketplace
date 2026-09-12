import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { createRole, getRole, updateRole } from '../lib/adminApi'
import { formatApiError } from '../lib/api'
import { PageHeader, Button, ErrorState, SkeletonRows, useToast } from '../components/ui'

/**
 * Every grantable scope, "section.subsection", paired with the key for
 * its label and for the one line saying what holding it actually lets
 * someone do.
 *
 * i18next keys cannot contain literal dots, which is why this is a map
 * rather than a key built from the scope string. Add a row here whenever
 * a new admin subsection becomes independently grantable.
 */
const AVAILABLE_SCOPES = [
  {
    scope: 'finance.withdrawals',
    labelKey: 'finance.adminWithdrawals',
    hintKey: 'admin.withdrawalsHint',
  },
  {
    scope: 'finance.topups',
    labelKey: 'admin.scopeFinanceTopups',
    hintKey: 'admin.topupsHint',
  },
  { scope: 'finance.rates', labelKey: 'admin.scopeFinanceRates', hintKey: 'admin.ratesHint' },
] as const

/**
 * Creating a role (id === "new") and editing one are the same screen:
 * both are a name plus a set of permissions, and splitting them would
 * mean maintaining that twice.
 *
 * Each permission says what it actually lets a person DO. A list of
 * scope names is a list a reader has to already understand; this one
 * can be read by someone deciding whether to hand it out.
 */
export default function AdminRoleDetail() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { id } = useParams()
  const toast = useToast()

  const isNew = id == null || id === 'new'
  const roleId = isNew ? null : Number(id)

  const [name, setName] = useState('')
  const [scopes, setScopes] = useState<string[]>([])
  const [loaded, setLoaded] = useState(isNew)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  function load() {
    if (roleId == null) return
    setLoadError(null)
    getRole(roleId)
      .then((role) => {
        setName(role.name)
        setScopes(role.scopes)
        setLoaded(true)
      })
      .catch((err) => setLoadError(formatApiError(err)))
  }

  useEffect(load, [roleId])

  function toggle(scope: string) {
    setScopes((prev) =>
      prev.includes(scope) ? prev.filter((s) => s !== scope) : [...prev, scope],
    )
  }

  async function save() {
    setBusy(true)
    try {
      if (isNew) {
        await createRole(name.trim(), scopes)
      } else if (roleId != null) {
        await updateRole(roleId, { name: name.trim(), scopes })
      }
      toast.success(t(isNew ? 'admin.roleCreated' : 'admin.roleSaved'))
      navigate('/admin/assistants/roles')
    } catch (err) {
      toast.error(formatApiError(err))
    } finally {
      setBusy(false)
    }
  }

  const title = t(isNew ? 'admin.createRoleTitle' : 'admin.editRoleTitle')

  if (loadError || !loaded) {
    return (
      <div className="ui-page">
        <PageHeader title={title} onBack={() => navigate(-1)} />
        <div className="ui-page-body">
          {loadError ? <ErrorState text={loadError} onRetry={load} /> : <SkeletonRows count={3} />}
        </div>
      </div>
    )
  }

  return (
    <div className="ui-page">
      <PageHeader title={title} onBack={() => navigate(-1)} />

      <div className="ui-page-body ui-page-body-action">
        <div className="co-form">
          <label className="ui-field" htmlFor="role-name">
            <span className="ui-field-label">{t('admin.roleNameLabel')}</span>
            <input
              id="role-name"
              className="ui-input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('admin.roleNamePlaceholder')}
            />
            <span className="ui-field-help">{t('admin.roleNameHint')}</span>
          </label>
        </div>

        <section className="ui-section">
          <h2 className="ui-section-title">{t('admin.roleScopesLabel')}</h2>
          <div className="ui-list">
            {AVAILABLE_SCOPES.map(({ scope, labelKey, hintKey }) => {
              const on = scopes.includes(scope)
              return (
                <button
                  type="button"
                  className="ui-row"
                  key={scope}
                  role="switch"
                  aria-checked={on}
                  onClick={() => toggle(scope)}
                >
                  <span className="ui-row-main">
                    <span className="ui-row-title">{t(labelKey)}</span>
                    {/* What holding this actually lets someone do. A list
                        of scope names can only be read by someone who
                        already knows them. */}
                    <span className="ui-row-subtitle">{t(hintKey)}</span>
                  </span>
                  <span className="ui-row-trailing">
                    <span className="ui-switch" aria-hidden="true" aria-checked={on} />
                  </span>
                </button>
              )
            })}
          </div>
          {/* A role that can do nothing is almost certainly a mistake,
              but it is a legal one — so this is a warning, not a block. */}
          {scopes.length === 0 && <p className="ui-field-help ar-empty">{t('admin.roleNoScopes')}</p>}
        </section>
      </div>

      <div className="ui-action-bar">
        <Button
          variant="primary"
          size="lg"
          block
          disabled={name.trim().length === 0}
          loading={busy}
          onClick={save}
        >
          {t('common.submit')}
        </Button>
      </div>
    </div>
  )
}
