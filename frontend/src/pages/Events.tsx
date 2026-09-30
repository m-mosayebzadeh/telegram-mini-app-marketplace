import { useTranslation } from 'react-i18next'
import { SpaceGround } from '../components/cosmos/SpaceGround'

/**
 * Events (TECHNICAL_REQUIREMENTS.md section 32): Echo nights — meeting new
 * people at a set hour around a theme — and, later, events where groups of
 * people compete. This is the door's first form, so the bar has somewhere
 * true to lead; the list itself is step five of the plan.
 */
export default function Events() {
  const { t } = useTranslation()
  return (
    <div className="cos-screen cos-events">
      <SpaceGround />
      <header className="cos-header">
        <span className="cos-header-place"><b className="cos-header-name">{t('events.title')}</b></span>
        <span className="cos-header-count">{t('events.sub')}</span>
      </header>
      <div className="cos-events-soon">
        <span className="cos-events-star" aria-hidden="true" />
        <h2>{t('events.soonTitle')}</h2>
        <p>{t('events.soonBody')}</p>
      </div>
    </div>
  )
}
