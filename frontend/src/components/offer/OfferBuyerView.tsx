import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { PriceBreakdown } from '../PriceBreakdown'
import { Button } from '../ui/Button'
import { DropAmount } from '../ui/Drop'
import { IconCheck, IconChevron, IconPersonFallback } from '../icons'
import type { Offer } from '../../lib/types'

interface OfferBuyerViewProps {
  offer: Offer
  /** Already sent a live request against this offer — the action stays
   *  visible but says so, rather than disappearing. */
  alreadyRequested: boolean
  sending: boolean
  onRequest: () => void
}

/**
 * What someone ELSE sees on an offer: who this is, what it costs, what
 * they get, and one button.
 *
 * The redesign's change of substance is the order. This page used to
 * open with a table of label/value rows — price, duration, status — and
 * put the provider behind two list rows near the bottom labelled "view
 * profile". But the offer is not the product; the person is. So the
 * person comes first, exactly as they appeared on the card that was
 * tapped to get here, and the numbers follow.
 *
 * The request button is pinned to the bottom of the screen by
 * .ui-action-bar, not placed inline — it is the one thing this page
 * exists for, and it belongs where the thumb already is.
 */
export function OfferBuyerView({
  offer,
  alreadyRequested,
  sending,
  onRequest,
}: OfferBuyerViewProps) {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const provider = offer.provider

  return (
    <>
      {provider && (
        <button
          type="button"
          className="of-person"
          onClick={() => navigate(`/profiles/${provider.user_id}`)}
        >
          <span className="of-person-avatar">
            {provider.avatar_url ? (
              <img src={provider.avatar_url} alt="" />
            ) : (
              <IconPersonFallback size={28} />
            )}
          </span>
          <span className="of-person-main">
            <span className="of-person-name" dir="auto">
              {provider.display_name}
              {provider.is_trusted && (
                <span className="pf-trusted" title={t('profilePage.trustedBadge')}>
                  <IconCheck size={12} />
                </span>
              )}
            </span>
            {provider.bio && <span className="of-person-bio">{provider.bio}</span>}
          </span>
          <IconChevron size={20} className="ui-row-chevron" />
        </button>
      )}

      {/* The deal itself: what it costs and what it buys, side by side,
          because those two numbers are only meaningful against each
          other. */}
      <section className="of-deal">
        <div className="of-deal-cell">
          <span className="of-deal-label">{t('offers.priceStarsLabel')}</span>
          <span className="of-deal-value">
            <DropAmount amount={offer.price_stars} locale={i18n.language} size={24} />
          </span>
          <PriceBreakdown priceStars={offer.price_stars} audience="buyer" />
        </div>
        <div className="of-deal-cell">
          <span className="of-deal-label">{t('offers.durationLabel')}</span>
          <span className="of-deal-value tabular">
            {t('discover.minutes', { minutes: offer.display_duration_minutes })}
          </span>
        </div>
      </section>

      <section className="ui-section">
        <h2 className="ui-section-title">{t('offers.descriptionLabel')}</h2>
        <p className="of-description" dir="auto">
          {offer.description}
        </p>
      </section>

      <div className="ui-list">
        <button
          className="ui-row"
          onClick={() => navigate(`/profiles/${offer.provider_id}/provider-summary`)}
        >
          <span className="ui-row-main">
            <span className="ui-row-title">{t('offers.viewProviderSummary')}</span>
          </span>
          <span className="ui-row-trailing">
            <IconChevron size={20} className="ui-row-chevron" />
          </span>
        </button>
      </div>

      {/* Pinned above the nav bar. The page scrolls underneath it, so
          the decision is always one tap away rather than something to
          scroll back to. */}
      <div className="ui-action-bar">
        <Button
          variant="primary"
          size="lg"
          block
          disabled={alreadyRequested}
          loading={sending}
          onClick={onRequest}
        >
          {alreadyRequested ? t('offers.requestSent') : t('offers.requestButton')}
        </Button>
      </div>
    </>
  )
}
