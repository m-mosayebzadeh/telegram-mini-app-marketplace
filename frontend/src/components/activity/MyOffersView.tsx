import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Button } from '../ui/Button'
import { Sheet } from '../ui/Sheet'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import { EmptyState, SkeletonRows } from '../ui/States'
import { DropAmount } from '../ui/Drop'
import { IconChevron, IconMore } from '../icons'
import type { Offer } from '../../lib/types'

interface MyOffersViewProps {
  offers: Offer[] | null
  onToggle: (offer: Offer) => void
  onDelete: (offer: Offer) => void
  onCreate: () => void
  busyOfferId: number | null
}

/**
 * The Activity tab's Offers segment: what the user is currently selling.
 *
 * Each row used to carry two small buttons of its own — activate and
 * delete — competing with the row's own tap target and with each other.
 * They are behind one overflow button now: managing an offer is
 * something you do occasionally, opening it to see who asked is what you
 * do every time, so the frequent action gets the row and the rare ones
 * get a sheet.
 */
export function MyOffersView({
  offers,
  onToggle,
  onDelete,
  onCreate,
  busyOfferId,
}: MyOffersViewProps) {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const [managing, setManaging] = useState<Offer | null>(null)
  const [deleting, setDeleting] = useState<Offer | null>(null)

  if (offers === null) return <SkeletonRows count={3} />

  return (
    <>
      {offers.length === 0 ? (
        <EmptyState
          title={t('activityPage.offersEmpty')}
          text={t('activityPage.offersEmptyHint')}
          actionLabel={t('offers.createNew')}
          onAction={onCreate}
        />
      ) : (
        <div className="ui-list">
          {offers.map((offer) => (
            <div className="ac-offer" key={offer.id}>
              <button
                type="button"
                className="ui-row ac-offer-main"
                onClick={() => navigate(`/offers/${offer.id}`)}
              >
                <span className="ui-row-main">
                  <span className="ui-row-title" dir="auto">
                    {offer.title}
                  </span>
                  <span className="ui-row-subtitle ac-offer-meta">
                    <DropAmount amount={offer.price_stars} locale={i18n.language} size={16} />
                    <span className="of-own-dot" aria-hidden="true" />
                    <span className="tabular">
                      {t('discover.minutes', { minutes: offer.display_duration_minutes })}
                    </span>
                  </span>
                </span>
                <span className="ui-row-trailing">
                  {/* Per-offer unseen requests. Cleared by opening THAT
                      offer, never by opening this list. */}
                  {!!offer.request_count && (
                    <span className="ui-badge">
                      {offer.request_count.toLocaleString(i18n.language)}
                    </span>
                  )}
                  {/* Status is a property of the offer, not an event, so
                      it is a neutral chip rather than a coloured one —
                      being inactive is a choice, not a problem. */}
                  {offer.status !== 'active' && (
                    <span className="ui-status ui-status-neutral">{t('offers.statusInactive')}</span>
                  )}
                  <IconChevron size={20} className="ui-row-chevron" />
                </span>
              </button>

              <button
                type="button"
                className="ui-btn ui-btn-icon ac-offer-manage"
                onClick={() => setManaging(offer)}
                aria-label={t('activityPage.manageOffer')}
              >
                <IconMore size={20} />
              </button>
            </div>
          ))}
        </div>
      )}

      {managing && (
        <Sheet title={managing.title} onClose={() => setManaging(null)}>
          <div className="ui-list">
            <button
              className="ui-row"
              onClick={() => {
                onToggle(managing)
                setManaging(null)
              }}
            >
              <span className="ui-row-main">
                <span className="ui-row-title">
                  {managing.status === 'active' ? t('offers.deactivate') : t('offers.activate')}
                </span>
                <span className="ui-row-subtitle">
                  {managing.status === 'active'
                    ? t('activityPage.deactivateHint')
                    : t('activityPage.activateHint')}
                </span>
              </span>
            </button>
            <button
              className="ui-row ac-row-danger"
              onClick={() => {
                setDeleting(managing)
                setManaging(null)
              }}
            >
              <span className="ui-row-main">
                <span className="ui-row-title">{t('offers.delete')}</span>
              </span>
            </button>
          </div>
        </Sheet>
      )}

      {/* Deleting used to go through window.confirm — the browser's own
          dialog, which inside a mini app reads as the page having gone
          wrong. */}
      {deleting && (
        <ConfirmDialog
          title={t('offers.delete')}
          text={t('offers.deleteConfirm')}
          confirmLabel={t('offers.delete')}
          destructive
          loading={busyOfferId === deleting.id}
          onCancel={() => setDeleting(null)}
          onConfirm={() => {
            onDelete(deleting)
            setDeleting(null)
          }}
        />
      )}

      {/* Creating an offer is what this segment is for when it is empty
          and the obvious next thing when it is not, so it gets the
          pinned bar rather than a row at the end of the list. */}
      {offers.length > 0 && (
        <div className="ui-action-bar">
          <Button variant="primary" size="lg" block onClick={onCreate}>
            {t('offers.createNew')}
          </Button>
        </div>
      )}
    </>
  )
}
