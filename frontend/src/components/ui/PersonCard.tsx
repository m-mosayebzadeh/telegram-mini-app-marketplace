import { useTranslation } from 'react-i18next'
import type { Offer } from '../../lib/types'
import { IconCheck, IconDrop, IconPersonFallback } from '../icons'

interface PersonCardProps {
  offer: Offer
  locale: string
  onClick: () => void
}

/**
 * The showcase card — docs/design-system/02-components.md#کارت-آدم
 *
 * The one place in the product where a card is the right shape, because
 * what it holds really is a detachable object: a person offering their
 * time. Everything else in the app is a list row.
 *
 * Reading order down the card: face, price, name, what they offer, how
 * long, and their interests. That order is the buyer's own order of
 * questions — who, how much, what, how long.
 */
export function PersonCard({ offer, locale, onClick }: PersonCardProps) {
  const { t } = useTranslation()
  const provider = offer.provider

  // An offer always has a provider in the showcase feed; falling back to
  // the offer's own title keeps the card renderable if it is ever used
  // somewhere that does not send one.
  const name = provider?.display_name ?? offer.title
  const line = provider?.bio?.trim() || offer.title

  return (
    <article className="ui-person-card">
      <button
        type="button"
        className="dc-card-hit"
        onClick={onClick}
        // The name is what a screen reader should hear first; the price
        // and duration follow as the card's own text.
        aria-label={name}
      >
        <div className="ui-person-photo">
          {provider?.avatar_url ? (
            <img
              src={provider.avatar_url}
              alt=""
              // The grid is above the fold, so these are the one set of
              // images worth fetching eagerly.
              loading="eager"
            />
          ) : (
            <span className="dc-card-nophoto">
              <IconPersonFallback size={40} />
            </span>
          )}

          <span className="ui-person-price">
            <span className="ui-drop tabular">
              <IconDrop size={14} />
              {offer.price_stars.toLocaleString(locale)}
            </span>
          </span>

          <div className="ui-person-scrim">
            <div className="ui-person-name">
              <bdi>{name}</bdi>
              {provider?.is_trusted && (
                <span className="dc-card-trusted" title={t('discover.trusted')}>
                  <IconCheck size={14} />
                </span>
              )}
            </div>
            <div className="ui-person-bio">{line}</div>
          </div>
        </div>
      </button>

      <div className="ui-person-tags">
        {/* Duration first — it is the part of the deal the price is for,
            and it belongs next to the price rather than buried in the
            tags. */}
        <span className="ui-tag dc-card-duration tabular">
          {t('discover.minutes', { minutes: offer.display_duration_minutes })}
        </span>
        {(provider?.interests ?? []).slice(0, 2).map((tag) => (
          <span className="ui-tag" key={tag}>
            {tag}
          </span>
        ))}
      </div>
    </article>
  )
}
