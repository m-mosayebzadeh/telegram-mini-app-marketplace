import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { pushState, turnPushOn } from '../../lib/push'
import { offerLater, offerWaiting, onPushOffer } from '../../lib/pushOffer'

/**
 * "Want to know when they answer?" (section 38) — a small card at the
 * bottom, offered right after a first message or a friend request, once,
 * and only where notifications can really be turned on. "Yes" brings the
 * browser's own prompt; "not now" waits a week.
 */
export function PushOffer() {
  const { t } = useTranslation()
  const [reason, setReason] = useState<'message' | 'friend' | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(
    () =>
      onPushOffer((why) => {
        if (!offerWaiting()) return
        void pushState().then((state) => {
          if (state === 'off') setReason(why)
        })
      }),
    [],
  )

  if (!reason) return null

  async function yes() {
    setBusy(true)
    await turnPushOn().catch(() => 'off')
    setReason(null)
    setBusy(false)
  }

  return (
    <div className="cos-push-offer" role="dialog" aria-labelledby="push-offer-title">
      <p id="push-offer-title">{t(reason === 'friend' ? 'push.offerFriend' : 'push.offerMessage')}</p>
      <div className="cos-push-offer-buttons">
        <button type="button" className="cos-push-offer-yes" disabled={busy} onClick={() => void yes()}>
          {t('push.yes')}
        </button>
        <button
          type="button"
          className="cos-push-offer-later"
          onClick={() => {
            offerLater()
            setReason(null)
          }}
        >
          {t('push.later')}
        </button>
      </div>
    </div>
  )
}
