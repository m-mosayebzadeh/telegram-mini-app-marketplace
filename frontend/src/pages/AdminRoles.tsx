import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Placeholder, Spinner } from '@telegram-apps/telegram-ui'
import { activateRole, deactivateRole, deleteRole, listRoles } from '../lib/adminApi'
import { formatApiError } from '../lib/api'
import { IconArrowNarrowLeft } from '../components/icons'
import type { Role } from '../lib/types'

type ConfirmAction = { role: Role; kind: 'delete' | 'deactivate' }

/**
 * "نقش و دسترسی" — every role that exists, each row leading to its own
 * edit page (rename + toggle scopes) when tapped, plus delete/
 * (de)activate and "who has this role" actions. "ایجاد نقش" sits near
 * the bottom, per the layout the user asked for.
 */
export default function AdminRoles() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [roles, setRoles] = useState<Role[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirming, setConfirming] = useState<ConfirmAction | null>(null)
  const [busy, setBusy] = useState(false)

  function load() {
    listRoles()
      .then(setRoles)
      .catch((err) => setError(formatApiError(err)))
  }

  useEffect(load, [])

  async function runConfirmedAction() {
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
      setError(formatApiError(err))
    } finally {
      setBusy(false)
    }
  }

  async function toggleActivate(role: Role) {
    // Reactivating needs no confirmation — it only ever RESTORES access
    // no one is currently missing on purpose, unlike deactivating/
    // deleting, which both take access away from real people.
    try {
      await activateRole(role.id)
      load()
    } catch (err) {
      setError(formatApiError(err))
    }
  }

  if (error) return <Placeholder header={t('common.error')}>{error}</Placeholder>

  return (
    <div className="hp-page">
      <div className="hp-page-back-header">
        <button className="hp-chat-back" onClick={() => navigate(-1)} aria-label={t('common.back')}>
          <IconArrowNarrowLeft size={20} />
        </button>
        <span className="hp-page-back-title">{t('admin.rolesTitle')}</span>
      </div>

      {roles == null ? (
        <Placeholder>
          <Spinner size="m" />
        </Placeholder>
      ) : roles.length === 0 ? (
        <p className="hp-empty">{t('admin.rolesEmpty')}</p>
      ) : (
        <div className="hp-list">
          {roles.map((role) => (
            <div key={role.id} className="hp-list-row" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
              <button className="hp-list-row-main" onClick={() => navigate(`/admin/assistants/roles/${role.id}`)}>
                <span className="hp-list-title">
                  {role.name}
                  {!role.is_active && <span className="hp-list-subtitle"> ({t('admin.roleInactiveLabel')})</span>}
                </span>
                <span className="hp-list-subtitle">{t('admin.roleMembersCount', { count: role.member_count })}</span>
              </button>
              <div className="hp-list-row-actions" style={{ marginTop: 8 }}>
                <button className="hp-btn-sm" onClick={() => navigate(`/admin/assistants/roles/${role.id}/members`)}>
                  {t('admin.viewMembersButton')}
                </button>
                {role.is_active ? (
                  <button className="hp-btn-sm" onClick={() => setConfirming({ role, kind: 'deactivate' })}>
                    {t('admin.deactivateButton')}
                  </button>
                ) : (
                  <button className="hp-btn-sm" onClick={() => toggleActivate(role)}>
                    {t('admin.activateButton')}
                  </button>
                )}
                <button className="hp-btn-sm" onClick={() => setConfirming({ role, kind: 'delete' })}>
                  {t('common.delete')}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="hp-field">
        <button className="hp-btn hp-btn-gradient" style={{ width: '100%' }} onClick={() => navigate('/admin/assistants/roles/new')}>
          {t('admin.createRoleButton')}
        </button>
      </div>

      {confirming && (
        <div className="hp-confirm-backdrop" onClick={() => setConfirming(null)}>
          <div className="hp-confirm-box" onClick={(e) => e.stopPropagation()}>
            <p className="hp-confirm-title">
              {confirming.kind === 'delete' ? t('common.delete') : t('admin.deactivateButton')}
            </p>
            <p className="hp-confirm-message">
              {t(confirming.kind === 'delete' ? 'admin.deleteRoleConfirmBody' : 'admin.deactivateRoleConfirmBody', {
                count: confirming.role.member_count,
              })}
            </p>
            <div className="hp-confirm-actions">
              <button className="hp-confirm-btn" onClick={() => setConfirming(null)}>
                {t('common.cancel')}
              </button>
              <button className="hp-confirm-btn hp-confirm-btn-danger" disabled={busy} onClick={runConfirmedAction}>
                {confirming.kind === 'delete' ? t('common.delete') : t('admin.deactivateButton')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
