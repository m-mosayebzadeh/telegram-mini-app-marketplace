import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { apiFetch, formatApiError } from '../lib/api'
import type { Balance, Offer } from '../lib/types'
import { PageHeader, EmptyState, ErrorState } from '../components/ui'
import { DropChip } from '../components/ui/Drop'
import { PersonCard } from '../components/ui/PersonCard'
import { IconDiscover } from '../components/icons'

/**
 * The showcase — the app's first tab, and the reason anyone opens it.
 *
 * Rebuilt on the design system (docs/design-system/). The shape of the
 * change is not the colours: this used to be a list of LISTINGS, each a
 * line of title and price. It is now a grid of PEOPLE, because what a
 * buyer is actually choosing between is people, and a name over a photo
 * answers that in a glance where a text row never did.
 *
 * Data: GET /offers with no provider_id returns every active offer with
 * its provider attached (backend/app/offer/router.py's _discovery_feed),
 * so the whole grid is one request.
 */

/** How the grid is ordered. Both are real questions a buyer asks; there
 *  is deliberately no "recommended", which would be a sort nobody can
 *  see the logic of. */
type Sort = 'newest' | 'cheapest'

export default function Discover() {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()

  const [offers, setOffers] = useState<Offer[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [balance, setBalance] = useState<Balance | null>(null)
  const [sort, setSort] = useState<Sort>('newest')
  const [interest, setInterest] = useState<string | null>(null)
  // Bumped to re-run the fetch when the error state's retry is tapped.
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let cancelled = false
    setError(null)
    setOffers(null)

    apiFetch<Offer[]>('/offers')
      .then((data) => {
        if (!cancelled) setOffers(data)
      })
      .catch((err) => {
        if (!cancelled) setError(formatApiError(err))
      })

    return () => {
      // The screen can be left while the request is in flight; without
      // this, the response sets state on a page nobody is looking at.
      cancelled = true
    }
  }, [attempt])

  useEffect(() => {
    // The balance chip is secondary: if it fails, the showcase still
    // works and the chip simply does not appear.
    apiFetch<Balance>('/wallet/balance')
      .then(setBalance)
      .catch(() => undefined)
  }, [])

  /** The interests that actually appear in this feed, most common first.
   *  Filters are built from the data rather than from a fixed list, so a
   *  chip never promises a category with nothing behind it. */
  const interests = useMemo(() => {
    if (!offers) return []
    const counts = new Map<string, number>()
    for (const offer of offers) {
      for (const tag of offer.provider?.interests ?? []) {
        counts.set(tag, (counts.get(tag) ?? 0) + 1)
      }
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 12)
      .map(([tag]) => tag)
  }, [offers])

  const visible = useMemo(() => {
    if (!offers) return []
    const filtered = interest
      ? offers.filter((offer) => offer.provider?.interests.includes(interest))
      : offers
    // A copy: sort() mutates, and the fetched array is the source of
    // truth for every other filter.
    return [...filtered].sort((a, b) =>
      sort === 'cheapest'
        ? a.price_stars - b.price_stars
        : Date.parse(b.created_at) - Date.parse(a.created_at),
    )
  }, [offers, interest, sort])

  return (
    <div className="ui-page">
      <PageHeader
        title={t('tabs.discover')}
        action={
          balance && (
            <DropChip
              amount={balance.balance_stars_equivalent}
              locale={i18n.language}
              onClick={() => navigate('/wallet')}
              label={t('wallet.title')}
            />
          )
        }
      />

      <div className="ui-page-body">
        {/* The rail stays put through every state, including loading:
            moving the controls around as data arrives is what makes a
            page feel like it is still assembling itself. */}
        <div className="ui-chip-rail dc-rail">
          <button
            type="button"
            className={`ui-chip${sort === 'newest' ? ' ui-chip-active' : ''}`}
            onClick={() => setSort('newest')}
          >
            {t('discover.sortNewest')}
          </button>
          <button
            type="button"
            className={`ui-chip${sort === 'cheapest' ? ' ui-chip-active' : ''}`}
            onClick={() => setSort('cheapest')}
          >
            {t('discover.sortCheapest')}
          </button>
          {interests.map((tag) => (
            <button
              type="button"
              key={tag}
              className={`ui-chip${interest === tag ? ' ui-chip-active' : ''}`}
              // Tapping the active one clears it — a filter you cannot
              // switch off is a trap.
              onClick={() => setInterest(interest === tag ? null : tag)}
            >
              {tag}
            </button>
          ))}
        </div>

        {error ? (
          <ErrorState text={error} onRetry={() => setAttempt((n) => n + 1)} />
        ) : !offers ? (
          <div className="dc-grid">
            {Array.from({ length: 6 }, (_, index) => (
              <div className="ui-skeleton ui-skeleton-card" key={index} />
            ))}
          </div>
        ) : visible.length === 0 ? (
          /* There is deliberately no separate "no match for this filter"
             state: the interest chips are built FROM the feed, so a chip
             can never be shown for something with nothing behind it, and
             an active filter can never empty the grid. An empty grid
             always means an empty marketplace. */
          <EmptyState
            icon={<IconDiscover size={24} />}
            title={t('discover.emptyTitle')}
            text={t('discover.emptyText')}
            actionLabel={t('offers.createNew')}
            onAction={() => navigate('/offers/new')}
          />
        ) : (
          <div className="dc-grid">
            {visible.map((offer) => (
              <PersonCard
                key={offer.id}
                offer={offer}
                locale={i18n.language}
                onClick={() => navigate(`/offers/${offer.id}`)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
