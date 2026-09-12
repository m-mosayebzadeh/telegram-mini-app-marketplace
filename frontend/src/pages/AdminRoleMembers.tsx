import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { getRole, listRoleMembers, revokeRole } from '../lib/adminApi'
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
import { IconPersonFallback, IconUsers } from '../components/icons'
import type { AdminUserSummary, Role } from '../lib/types'

/**
 * Everyone who currently holds one role, with revoke on the row.
 *
 * The same revoke as the one on a user's own role list, reached from the
 * role's side instead of the person's — which is the side you are on
 * when the question is "who can do this?" rather than "what can they do?"
 */
export default function AdminRoleMembers() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { id } = useParams()
  const toast = useToast()
  const roleId = Number(id)

  const [role, setRole] = useState<Role | null>(null)
  const [members, setMembers] = useState<AdminUserSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [revoking, setRevoking] = useState<AdminUserSummary | null>(null)
  const [busy, setBusy] = useState(false)

  function load() {
    setError(null)
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
    if (!revoking) return
    setBusy(true)
    try {
      await revokeRole(revoking.user_id, roleId)
      setRevoking(null)
      load()
    } catch (err) {
      toast.error(formatApiError(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="ui-page">
      {/* The role's name IS the title once it has loaded: "Members" on
          its own does not say members of what. */}
      <PageHeader
        title={role ? role.name : t('admin.roleMembersTitle')}
        onBack={() => navigate('/admin/assistants/roles')}
      />

      <div className="ui-page-body">
        {error ? (
          <ErrorState text={error} onRetry={load} />
        ) : members === null ? (
          <SkeletonRows count={3} />
        ) : members.length === 0 ? (
          <EmptyState
            icon={<IconUsers size={24} />}
            title={t('admin.roleMembersEmpty')}
            text={t('admin.roleMembersEmptyHint')}
          />
        ) : (
          <div className="ui-list">
            {members.map((user) => (
              <div className="fr-row" key={user.user_id}>
                <button
                  type="button"
                  className="ui-row ui-row-avatar"
                  onClick={() => navigate(`/admin/users/${user.user_id}`)}
                >
                  <span className="ui-row-media fl-avatar">
                    {user.avatar_url ? (
                      <img src={user.avatar_url} alt="" />
                    ) : (
                      <IconPersonFallback size={22} />
                    )}
                  </span>
                  <span className="ui-row-main">
                    <span className="ui-row-title" dir="auto">
                      {user.display_name}
                    </span>
                    {user.username && <span className="ui-row-subtitle">@{user.username}</span>}
                  </span>
                </button>

                <div className="fr-actions fr-actions-single">
                  <Button variant="danger" size="sm" onClick={() => setRevoking(user)}>
                    {t('admin.revokeRoleButton')}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {revoking && (
        <ConfirmDialog
          title={t('admin.revokeRoleButton')}
          text={t('admin.revokeRoleConfirmBody')}
          confirmLabel={t('admin.revokeRoleButton')}
          destructive
          loading={busy}
          onCancel={() => setRevoking(null)}
          onConfirm={confirmRevoke}
        />
      )}
    </div>
  )
}
