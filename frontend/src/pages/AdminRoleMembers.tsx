import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Avatar, Placeholder, Spinner } from '@telegram-apps/telegram-ui'
import { getRole, listRoleMembers, revokeRole } from '../lib/adminApi'
import { formatApiError } from '../lib/api'
import { IconArrowNarrowLeft } from '../components/icons'
import type { AdminUserSummary, Role } from '../lib/types'

/** "مشاهده افرادی که این نقش رو دارن" — every current holder of one
 * role, with a revoke action right on the row (the same action as
 * AdminUserRoles.tsx's, just reached from the role's own side instead
 * of the user's). */
export default function AdminRoleMembers() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { id } = useParams()
  const roleId = Number(id)

  const [role, setRole] = useState<Role | null>(null)
  const [members, setMembers] = useState<AdminUserSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [revokeTarget, setRevokeTarget] = useState<AdminUserSummary | null>(null)
  const [busy, setBusy] = useState(false)

  function load() {
    listRoleMembers(roleId)
      .then(setMembers)
      .catch((err) => setError(formatApiError(err)))
  }

  useEffect(() => {
    getRole(roleId)
      .then(setRole)
      .catch((err) => setError(formatApiError(err)))
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roleId])

  async function confirmRevoke() {
    if (!revokeTarget) return
    setBusy(true)
    try {
      await revokeRole(revokeTarget.user_id, roleId)
      setRevokeTarget(null)
      load()
    } catch (err) {
      setError(formatApiError(err))
    } finally {
      setBusy(false)
    }
  }

  if (error) return <Placeholder header={t('common.error')}>{error}</Placeholder>

  return (
    <div className="hp-page">
      <div className="hp-page-back-header">
        <button className="hp-chat-back" onClick={() => navigate(-1)} aria-label={t('common.back')}>
          <IconArrowNarrowLeft size={20} />
        </button>
        <span className="hp-page-back-title">
          {t('admin.roleMembersTitle')}
          {role ? ` — ${role.name}` : ''}
        </span>
      </div>

      {members == null ? (
        <Placeholder>
          <Spinner size="m" />
        </Placeholder>
      ) : members.length === 0 ? (
        <p className="hp-empty">{t('admin.roleMembersEmpty')}</p>
      ) : (
        <div className="hp-list">
          {members.map((user) => (
            <div key={user.user_id} className="hp-list-row">
              <button
                className="hp-list-row-main hp-list-row-identity"
                onClick={() => navigate(`/profiles/${user.user_id}`)}
              >
                <Avatar
                  size={40}
                  src={user.avatar_url ?? undefined}
                  acronym={user.display_name.slice(0, 1).toUpperCase()}
                />
                <span className="hp-list-row-text">
                  <span className="hp-list-title" dir="auto">
                    {user.display_name}
                  </span>
                  {user.username && <span className="hp-list-subtitle">@{user.username}</span>}
                </span>
              </button>
              <div className="hp-list-row-actions">
                <button className="hp-btn-sm" onClick={() => setRevokeTarget(user)}>
                  {t('admin.revokeRoleButton')}
                </button>
              </div>
            </div>
          ))}
        </div>
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
