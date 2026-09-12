import { useTranslation } from 'react-i18next'
import { ProsCons } from './ProsCons'
import { IconExternalLink } from '../icons'

/** Third-party sellers. Plain outbound links — nothing here touches the
 *  wallet, and the app has no relationship with any of them. */
const SITES = [
  {
    key: 'intermediarySiteIranicard',
    url: 'https://www.iranicard.ir/payments/foreign-services/telegram-stars/',
  },
  { key: 'intermediarySiteNumberland', url: 'https://numberland.ir/account/telegram-stars' },
  { key: 'intermediarySiteSubtg', url: 'https://subtg.com/telegram-stars' },
] as const

export function TopUpIntermediaries() {
  const { t } = useTranslation()

  return (
    <>
      <ProsCons cons={[t('topup.intermediariesCon1'), t('topup.intermediariesCon2')]} />

      <div className="ui-list">
        {SITES.map((site) => (
          <a
            key={site.key}
            className="ui-row"
            href={site.url}
            target="_blank"
            // noreferrer implies noopener: the opened page must not get a
            // handle on this window.
            rel="noreferrer"
          >
            <span className="ui-row-main">
              <span className="ui-row-title">{t(`topup.${site.key}`)}</span>
            </span>
            <span className="ui-row-trailing">
              {/* Says the tap leaves the app before it happens — the one
                  thing a link out owes the reader. */}
              <IconExternalLink size={18} />
            </span>
          </a>
        ))}
      </div>
    </>
  )
}
