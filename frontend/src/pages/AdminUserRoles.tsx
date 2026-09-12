import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Placeholder, Spinner } from '@telegram-apps/telegram-ui'
import { assignRole, getUserDetail, listRoles, listUserRoles, revokeRole } from '../lib/adminApi'
import { formatApiError } from '../lib/api'
import { Sheet } from '../components/ui/Sheet'
import { IconArrowNarrowLeft } from '../components/icons'
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
      setError(formatApiError(err))
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
      setError(formatApiError(err))
    } finally {
      setBusy(false)
    }
  }

  if (error) return <Placeholder header={t('common.error')}>{error}</Placeholder>

  // Roles the user doesn't already hold — the only ones worth offering
  // in the "افزودن نقش" sheet.
  const heldRoleIds = new Set((roles ?? []).map((r) => r.role_id))
  const assignableRoles = (allRoles ?? []).filter((r) => !heldRoleIds.has(r.id))

  return (
    <div className="hp-page">
      <div className="hp-page-back-header">
        <button className="hp-chat-back" onClick={() => navigate(-1)} aria-label={t('common.back')}>
          <IconArrowNarrowLeft size={20} />
        </button>
        <span className="hp-page-back-title">
          {t('admin.userRolesTitle')}
          {user ? ` — ${user.display_name}` : ''}
        </span>
      </div>

      {roles == null ? (
        <Placeholder>
          <Spinner size="m" />
        </Placeholder>
      ) : roles.length === 0 ? (
        <p className="hp-empty">{t('admin.userRolesEmpty')}</p>
      ) : (
        <div className="hp-list">
          {roles.map((role) => (
            <div key={role.role_id} className="hp-list-row">
              <span className="hp-list-title">
                {role.role_name}
                {!role.is_active && (
                  <span className="hp-list-subtitle"> ({t('admin.roleInactiveLabel')})</span>
                )}
              </span>
              <div className="hp-list-row-actions">
                <button className="hp-btn-sm" onClick={() => navigate(`/admin/assistants/roles/${role.role_id}`)}>
                  {t('admin.viewPermissionsButton')}
                </button>
                <button className="hp-btn-sm" onClick={() => setRevokeTarget(role)}>
                  {t('admin.revokeRoleButton')}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="hp-field">
        <button className="hp-btn hp-btn-gradient" style={{ width: '100%' }} onClick={openAddRole}>
          {t('admin.addRoleButton')}
        </button>
      </div>

      {addingRole && (
        <Sheet title={t('admin.addRoleButton')} onClose={() => setAddingRole(false)}>
          {allRoles == null ? (
            <Placeholder>
              <Spinner size="s" />
            </Placeholder>
          ) : assignableRoles.length === 0 ? (
            <p className="hp-empty">{t('admin.addRoleEmpty')}</p>
          ) : (
            <div className="hp-list">
              {assignableRoles.map((role) => (
                <button key={role.id} className="hp-list-row" disabled={busy} onClick={() => pickRoleToAdd(role.id)}>
                  <span className="hp-list-title">{role.name}</span>
                </button>
              ))}
            </div>
          )}
        </Sheet>
      )}

      {revokeTarget && (
        <div className="hp-confirm-backdrop" onClick={() => setRevokeTarget(null)}>
          <div className="hp-confirm-box" onClick={(e) => e.stopPropagation()}>
            <p className="hp-confirm-title">{t('admin.revokeRoleButton')}</p>
            <p className="hp-confirm-message">{t('admin.revokeRoleConfirmBody')}</p>
            <div className="hp-confirm-actions">
              <button className="hp-confirm-btn" onClick={() => setRevokeTarget(null)}>
                {t('common.cancel')}
              </button>
              <button className="hp-confirm-btn hp-confirm-btn-danger" disabled={busy} onClick={confirmRevoke}>
                {t('admin.revokeRoleButton')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
