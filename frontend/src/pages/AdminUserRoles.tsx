import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { assignRole, getUserDetail, listRoles, listUserRoles, revokeRole } from '../lib/adminApi'
import { formatApiError } from '../lib/api'
import { Sheet } from '../components/ui/Sheet'
import {
  PageHeader,
  Button,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  SkeletonRows,
  useToast,
} from '../components/ui'
import { IconChevron, IconShieldLock } from '../components/icons'
import type { AdminUserDetail, Role, UserRole } from '../lib/types'

/**
 * "لیست نقش‌ها" — a specific user's own roles: view each role's own
 * permissions, revoke one (with a confirm popup), or assign a brand
 * new one — this is also where a user gets their VERY FIRST role
 * (turning them into an assistant in the first place), per the product
 * decision behind this (see TECHNICAL_REQUIREMENTS.md).
 */
export default function AdminUserRoles() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const toast = useToast()
  const { id } = useParams()
  const userId = Number(id)

  const [user, setUser] = useState<AdminUserDetail | null>(null)
  const [roles, setRoles] = useState<UserRole[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [revokeTarget, setRevokeTarget] = useState<UserRole | null>(null)
  const [addingRole, setAddingRole] = useState(false)
  const [allRoles, setAllRoles] = useState<Role[] | null>(null)
  const [busy, setBusy] = useState(false)

  function loadRoles() {
    listUserRoles(userId)
      .then(setRoles)
      .catch((err) => setError(formatApiError(err)))
  }

  useEffect(() => {
    getUserDetail(userId)
      .then(setUser)
      .catch((err) => setError(formatApiError(err)))
    loadRoles()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId])

  async function confirmRevoke() {
    if (!revokeTarget) return
    setBusy(true)
    try {
      await revokeRole(userId, revokeTarget.role_id)
      setRevokeTarget(null)
      loadRoles()
    } catch (err) {
      toast.error(formatApiError(err))
    } finally {
      setBusy(false)
    }
  }

  function openAddRole() {
    setAddingRole(true)
    listRoles()
      .then(setAllRoles)
      .catch((err) => setError(formatApiError(err)))
  }

  async function pickRoleToAdd(roleId: number) {
    setBusy(true)
    try {
      await assignRole(userId, roleId)
      setAddingRole(false)
      loadRoles()
    } catch (err) {
      toast.error(formatApiError(err))
    } finally {
      setBusy(false)
    }
  }

  // Roles the user does not already hold — the only ones worth offering.
  const heldRoleIds = new Set((roles ?? []).map((r) => r.role_id))
  const assignableRoles = (allRoles ?? []).filter((r) => !heldRoleIds.has(r.id))

  return (
    <div className="ui-page">
      {/* The person's name IS the title once loaded: "Roles" on its own
          does not say whose. */}
      <PageHeader
        title={user ? user.display_name : t('admin.userRolesTitle')}
        onBack={() => navigate(-1)}
      />

      <div className="ui-page-body ui-page-body-action">
        {error ? (
          <ErrorState text={error} onRetry={loadRoles} />
        ) : roles == null ? (
          <SkeletonRows count={3} />
        ) : roles.length === 0 ? (
          <EmptyState
            icon={<IconShieldLock size={24} />}
            title={t('admin.userRolesEmpty')}
            text={t('admin.userRolesEmptyHint')}
          />
        ) : (
          <div className="ui-list">
            {roles.map((role) => (
              <div className="fr-row" key={role.role_id}>
                <button
                  type="button"
                  className="ui-row"
                  onClick={() => navigate(`/admin/assistants/roles/${role.role_id}`)}
                >
                  <span className="ui-row-main">
                    <span className="ui-row-title">{role.role_name}</span>
                    <span className="ui-row-subtitle">{t('admin.viewPermissionsButton')}</span>
                  </span>
                  <span className="ui-row-trailing">
                    {!role.is_active && (
                      <span className="ui-status ui-status-neutral">
                        {t('admin.roleInactiveLabel')}
                      </span>
                    )}
                    <IconChevron size={20} className="ui-row-chevron" />
                  </span>
                </button>

                <div className="fr-actions fr-actions-single">
                  <Button variant="danger" size="sm" onClick={() => setRevokeTarget(role)}>
                    {t('admin.revokeRoleButton')}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="ui-action-bar">
        <Button variant="primary" size="lg" block onClick={openAddRole}>
          {t('admin.addRoleButton')}
        </Button>
      </div>

      {addingRole && (
        <Sheet title={t('admin.addRoleButton')} onClose={() => setAddingRole(false)}>
          {allRoles == null ? (
            <SkeletonRows count={2} />
          ) : assignableRoles.length === 0 ? (
            <EmptyState title={t('admin.addRoleEmpty')} text={t('admin.addRoleEmptyHint')} />
          ) : (
            <div className="ui-list">
              {assignableRoles.map((role) => (
                <button
                  className="ui-row"
                  key={role.id}
                  disabled={busy}
                  onClick={() => pickRoleToAdd(role.id)}
                >
                  <span className="ui-row-main">
                    <span className="ui-row-title">{role.name}</span>
                  </span>
                </button>
              ))}
            </div>
          )}
        </Sheet>
      )}

      {revokeTarget && (
        <ConfirmDialog
          title={t('admin.revokeRoleButton')}
          text={t('admin.revokeRoleConfirmBody')}
          confirmLabel={t('admin.revokeRoleButton')}
          destructive
          loading={busy}
          onCancel={() => setRevokeTarget(null)}
          onConfirm={confirmRevoke}
        />
      )}
    </div>
  )
}
