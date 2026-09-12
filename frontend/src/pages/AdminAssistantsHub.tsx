import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useMe } from '../lib/MeContext'
import { PageHeader, EmptyState, NavRow } from '../components/ui'
import { IconShieldLock } from '../components/icons'

/**
 * Assistants: who has admin access, and the roles that grant it.
 *
 * Owner-only. Access is given through reusable roles rather than a flat
 * scope list copied per person, which is what makes "revoke everything
 * this job could do" one action instead of an audit.
 */
export default function AdminAssistantsHub() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { adminAccess } = useMe()

  if (!adminAccess) return null

  return (
    <div className="ui-page">
      <PageHeader title={t('admin.sectionAssistants')} onBack={() => navigate('/admin')} />

      <div className="ui-page-body">
        {!adminAccess.is_owner ? (
          <EmptyState
            icon={<IconShieldLock size={24} />}
            title={t('admin.noAccess')}
            text={t('admin.ownerOnlyHint')}
          />
        ) : (
          <div className="ui-list">
            <NavRow
              title={t('admin.sectionAssistantSearch')}
              subtitle={t('admin.assistantSearchHint')}
              onClick={() => navigate('/admin/assistants/search')}
            />
            <NavRow
              title={t('admin.sectionRoles')}
              subtitle={t('admin.rolesHint')}
              onClick={() => navigate('/admin/assistants/roles')}
            />
          </div>
        )}
      </div>
    </div>
  )
}
