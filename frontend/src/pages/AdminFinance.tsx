import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useMe } from '../lib/MeContext'

/** "مالی" section — subsections are individually grantable
 * ("finance.topups", later "finance.withdrawals", "finance.rates"). */
export default function AdminFinance() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { adminAccess } = useMe()

  if (!adminAccess) return null
  const hasTopups = adminAccess.is_owner || adminAccess.scopes.includes('finance.topups')

  return (
    <div className="hp-page">
      <div className="hp-page-header">{t('admin.sectionFinance')}</div>
      <div className="hp-list">
        {hasTopups && (
          <button className="hp-list-row" onClick={() => navigate('/admin/topups')}>
            <span className="hp-list-title">{t('admin.topupsTitle')}</span>
          </button>
        )}
      </div>
    </div>
  )
}
