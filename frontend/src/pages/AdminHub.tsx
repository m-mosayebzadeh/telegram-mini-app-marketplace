import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useMe } from '../lib/MeContext'

/**
 * The admin panel's own "home" — a list of top-level sections (see the
 * discussion in the chat that led here: as admin functionality grows,
 * it needs real sections/subsections, not one flat settings row).
 * Each section has its own sub-page with its own subsections; access is
 * granted per SUBSECTION (e.g. "finance.topups"), namespaced as
 * "section.subsection" — see backend/app/models/admin_grant.py. Only
 * sections the current user actually has something in are listed.
 */
export default function AdminHub() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { adminAccess } = useMe()

  if (!adminAccess) return null
  const hasFinance = adminAccess.is_owner || adminAccess.scopes.some((s) => s.startsWith('finance.'))

  return (
    <div className="hp-page">
      <div className="hp-page-header">{t('admin.hubTitle')}</div>
      <div className="hp-list">
        {hasFinance && (
          <button className="hp-list-row" onClick={() => navigate('/admin/finance')}>
            <span className="hp-list-title">💰 {t('admin.sectionFinance')}</span>
          </button>
        )}
        {adminAccess.is_owner && (
          <button className="hp-list-row" onClick={() => navigate('/admin/access')}>
            <span className="hp-list-title">🔐 {t('admin.sectionAccess')}</span>
          </button>
        )}
      </div>
    </div>
  )
}
