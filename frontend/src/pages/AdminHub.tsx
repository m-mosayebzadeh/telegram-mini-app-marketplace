import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useMe } from '../lib/MeContext'
import { PageHeader, EmptyState, NavRow } from '../components/ui'
import { IconCoin, IconShieldLock, IconUsers } from '../components/icons'

/**
 * The admin panel's home: the top-level sections, each with its own
 * sub-page.
 *
 * A section a person cannot enter is not shown at all rather than shown
 * disabled — a greyed row is a promise of something they will never be
 * able to open, and telling someone what they are not allowed to do is
 * not this screen's job.
 */
export default function AdminHub() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { adminAccess } = useMe()

  if (!adminAccess) return null

  const hasFinance =
    adminAccess.is_owner || adminAccess.scopes.some((s) => s.startsWith('finance.'))
  const nothing = !hasFinance && !adminAccess.is_owner

  return (
    <div className="ui-page">
      <PageHeader title={t('admin.hubTitle')} />

      <div className="ui-page-body">
        {nothing ? (
          <EmptyState
            icon={<IconShieldLock size={24} />}
            title={t('admin.noAccess')}
            text={t('admin.noAccessHint')}
          />
        ) : (
          <div className="ui-list">
            {hasFinance && (
              <NavRow
                icon={<IconCoin size={20} />}
                title={t('admin.sectionFinance')}
                subtitle={t('admin.sectionFinanceHint')}
                onClick={() => navigate('/admin/finance')}
              />
            )}
            {adminAccess.is_owner && (
              <NavRow
                icon={<IconUsers size={20} />}
                title={t('admin.sectionUsers')}
                subtitle={t('admin.sectionUsersHint')}
                onClick={() => navigate('/admin/users')}
              />
            )}
            {adminAccess.is_owner && (
              <NavRow
                icon={<IconShieldLock size={20} />}
                title={t('admin.sectionAssistants')}
                subtitle={t('admin.sectionAssistantsHint')}
                onClick={() => navigate('/admin/assistants')}
              />
            )}
          </div>
        )}
      </div>
    </div>
  )
}
