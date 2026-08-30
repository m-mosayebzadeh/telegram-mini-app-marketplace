import { useTranslation } from 'react-i18next'

interface ConnectionBannerProps {
  online: boolean
}

/**
 * A thin notice shown while the browser reports itself offline — never
 * anything more disruptive than that. The session underneath keeps
 * whatever state it already had; this banner is purely informational
 * (TECHNICAL_REQUIREMENTS.md section 12: a dropped connection must never
 * terminate a session).
 */
export function ConnectionBanner({ online }: ConnectionBannerProps) {
  const { t } = useTranslation()

  if (online) return null

  return (
    <div className="hp-chat-connection-banner">
      <span className="hp-chat-connection-dot" aria-hidden="true" />
      {t('chatSession.connectionLost')}
    </div>
  )
}
