import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useMe } from '../lib/MeContext'
import { PageHeader, NavRow } from '../components/ui'

/**
 * The finance section. Each subsection is separately grantable
 * ("finance.withdrawals", "finance.topups", "finance.rates"), so an
 * assistant sees only the ones they hold.
 */
export default function AdminFinance() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { adminAccess } = useMe()

  if (!adminAccess) return null

  const can = (scope: string) => adminAccess.is_owner || adminAccess.scopes.includes(scope)

  return (
    <div className="ui-page">
      <PageHeader title={t('admin.sectionFinance')} onBack={() => navigate('/admin')} />

      <div className="ui-page-body">
        <div className="ui-list">
          {can('finance.withdrawals') && (
            <NavRow
              title={t('finance.adminWithdrawals')}
              subtitle={t('admin.withdrawalsHint')}
              onClick={() => navigate('/admin/withdrawals')}
            />
          )}
          {can('finance.topups') && (
            <NavRow
              title={t('admin.topupsTitle')}
              subtitle={t('admin.topupsHint')}
              onClick={() => navigate('/admin/topups')}
            />
          )}
          {can('finance.rates') && (
            <NavRow
              title={t('admin.ratesTitle')}
              subtitle={t('admin.ratesHint')}
              onClick={() => navigate('/admin/rates')}
            />
          )}
        </div>
      </div>
    </div>
  )
}
