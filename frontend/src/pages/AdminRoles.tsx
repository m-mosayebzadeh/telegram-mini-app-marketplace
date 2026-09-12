import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { activateRole, deactivateRole, deleteRole, listRoles } from '../lib/adminApi'
import { formatApiError } from '../lib/api'
import {
  PageHeader,
  Button,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  SkeletonRows,
  useToast,
} from '../components/ui'
import { Sheet } from '../components/ui/Sheet'
import { IconChevron, IconMore, IconShieldLock } from '../components/icons'
import type { Role } from '../lib/types'

type Confirming = { role: Role; kind: 'delete' | 'deactivate' }

/**
 * Every role that exists. A role is a named job — "reviews top-ups" —
 * and access is granted by giving someone the role, so revoking what a
 * job can do is one edit rather than an audit of everyone who holds it.
 *
 * Tapping a role opens it for editing. The rarer actions — who holds it,
 * deactivate, delete — are behind one overflow, the same pattern the
 * offers list uses, rather than three small buttons per row.
 */
export default function AdminRoles() {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const toast = useToast()

  const [roles, setRoles] = useState<Role[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [managing, setManaging] = useState<Role | null>(null)
  const [confirming, setConfirming] = useState<Confirming | null>(null)
  const [busy, setBusy] = useState(false)

  function load() {
    setError(null)
    listRoles()
      .then(setRoles)
      .catch((err) => setError(formatApiError(err)))
  }

  useEffect(load, [])

  async function runConfirmed() {
    if (!confirming) return
    setBusy(true)
    try {
      if (confirming.kind === 'delete') {
        await deleteRole(confirming.role.id)
      } else {
        await deactivateRole(confirming.role.id)
      }
      setConfirming(null)
      load()
    } catch (err) {
      toast.error(formatApiError(err))
    } finally {
      setBusy(false)
    }
  }

  async function activate(role: Role) {
    // Reactivating asks nothing: it only ever RESTORES access that was
    // deliberately taken away, unlike deactivate and delete, which both
    // take access away from real people.
    try {
      await activateRole(role.id)
      load()
    } catch (err) {
      toast.error(formatApiError(err))
    }
  }

  return (
    <div className="ui-page">
      <PageHeader
        title={t('admin.rolesTitle')}
        onBack={() => navigate('/admin/assistants')}
      />

      <div className="ui-page-body ui-page-body-action">
        {error ? (
          <ErrorState text={error} onRetry={load} />
        ) : roles === null ? (
          <SkeletonRows count={3} />
        ) : roles.length === 0 ? (
          <EmptyState
            icon={<IconShieldLock size={24} />}
            title={t('admin.rolesEmpty')}
            text={t('admin.rolesEmptyHint')}
            actionLabel={t('admin.createRoleButton')}
            onAction={() => navigate('/admin/assistants/roles/new')}
          />
        ) : (
          <div className="ui-list">
            {roles.map((role) => (
              <div className="ac-offer" key={role.id}>
                <button
                  type="button"
                  className="ui-row ac-offer-main"
                  onClick={() => navigate(`/admin/assistants/roles/${role.id}`)}
                >
                  <span className="ui-row-main">
                    <span className="ui-row-title">{role.name}</span>
                    <span className="ui-row-subtitle">
                      {t('admin.roleMembersCount', { count: role.member_count })}
                    </span>
                  </span>
                  <span className="ui-row-trailing">
                    {/* Inactive is a state of the role, not a failure —
                        a neutral chip, and only shown when it applies. */}
                    {!role.is_active && (
                      <span className="ui-status ui-status-neutral">
                        {t('admin.roleInactiveLabel')}
                      </span>
                    )}
                    <IconChevron size={20} className="ui-row-chevron" />
                  </span>
                </button>

                <button
                  type="button"
                  className="ui-btn ui-btn-icon ac-offer-manage"
                  onClick={() => setManaging(role)}
                  aria-label={t('admin.manageRole')}
                >
                  <IconMore size={20} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="ui-action-bar">
        <Button
          variant="primary"
          size="lg"
          block
          onClick={() => navigate('/admin/assistants/roles/new')}
        >
          {t('admin.createRoleButton')}
        </Button>
      </div>

      {managing && (
        <Sheet title={managing.name} onClose={() => setManaging(null)}>
          <div className="ui-list">
            <button
              className="ui-row"
              onClick={() => {
                setManaging(null)
                navigate(`/admin/assistants/roles/${managing.id}/members`)
              }}
            >
              <span className="ui-row-main">
                <span className="ui-row-title">{t('admin.viewMembersButton')}</span>
                <span className="ui-row-subtitle">
                  {managing.member_count.toLocaleString(i18n.language)}
                </span>
              </span>
            </button>

            {managing.is_active ? (
              <button
                className="ui-row"
                onClick={() => {
                  setConfirming({ role: managing, kind: 'deactivate' })
                  setManaging(null)
                }}
              >
                <span className="ui-row-main">
                  <span className="ui-row-title">{t('admin.deactivateButton')}</span>
                  <span className="ui-row-subtitle">{t('admin.deactivateRoleHint')}</span>
                </span>
              </button>
            ) : (
              <button
                className="ui-row"
                onClick={() => {
                  activate(managing)
                  setManaging(null)
                }}
              >
                <span className="ui-row-main">
                  <span className="ui-row-title">{t('admin.activateButton')}</span>
                </span>
              </button>
            )}

            <button
              className="ui-row ac-row-danger"
              onClick={() => {
                setConfirming({ role: managing, kind: 'delete' })
                setManaging(null)
              }}
            >
              <span className="ui-row-main">
                <span className="ui-row-title">{t('common.delete')}</span>
              </span>
            </button>
          </div>
        </Sheet>
      )}

      {/* Both of these take access away from people who currently have
          it, so both say how many before they happen. */}
      {confirming && (
        <ConfirmDialog
          title={
            confirming.kind === 'delete' ? t('common.delete') : t('admin.deactivateButton')
          }
          text={t(
            confirming.kind === 'delete'
              ? 'admin.deleteRoleConfirmBody'
              : 'admin.deactivateRoleConfirmBody',
            { count: confirming.role.member_count },
          )}
          confirmLabel={
            confirming.kind === 'delete' ? t('common.delete') : t('admin.deactivateButton')
          }
          destructive
          loading={busy}
          onCancel={() => setConfirming(null)}
          onConfirm={runConfirmed}
        />
      )}
    </div>
  )
}
