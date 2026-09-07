import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { IconArrowNarrowLeft } from '../components/icons'
import { useMe } from '../lib/MeContext'

/**
 * "دستیاران" — the section's own two subsections, same list-of-rows
 * pattern as AdminFinance.tsx. Owner-only (see AdminHub.tsx).
 */
export default function AdminAssistantsHub() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { adminAccess } = useMe()

  if (!adminAccess) return null
  if (!adminAccess.is_owner) return <div className="hp-page hp-empty">{t('admin.noAccess')}</div>

  return (
    <div className="hp-page">
      <div className="hp-page-back-header">
        <button className="hp-chat-back" onClick={() => navigate(-1)} aria-label={t('common.back')}>
          <IconArrowNarrowLeft size={20} />
        </button>
        <span className="hp-page-back-title">{t('admin.sectionAssistants')}</span>
      </div>
      <div className="hp-list">
        <button className="hp-list-row" onClick={() => navigate('/admin/assistants/search')}>
          <span className="hp-list-title">{t('admin.sectionAssistantSearch')}</span>
        </button>
        <button className="hp-list-row" onClick={() => navigate('/admin/assistants/roles')}>
          <span className="hp-list-title">{t('admin.sectionRoles')}</span>
        </button>
      </div>
    </div>
  )
}
