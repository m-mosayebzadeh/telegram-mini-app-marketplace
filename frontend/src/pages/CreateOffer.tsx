import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { PriceBreakdown } from '../components/PriceBreakdown'
import { DropAmountField } from '../components/topup/DropAmountField'
import { apiFetch, formatApiError } from '../lib/api'
import { PageHeader, Button, useToast } from '../components/ui'
import { DurationField, STEP_MINUTES } from '../components/offer/DurationField'

/** What a title and a description are allowed to be — the same limits
 *  the backend enforces (see backend/app/offer/schemas.py), stated here
 *  so the counter is honest rather than decorative. */
const TITLE_MAX = 200
const DESCRIPTION_MAX = 2000

/** A session is always sold in this many equal blocks — the same constant the
 *  backend enforces (see backend/app/core/config.py's SESSION_BLOCK_COUNT). */
const SESSION_BLOCK_COUNT = 4

/**
 * Creating an offer: what you are offering, what it costs, and how long
 * it lasts.
 *
 * The fields are in the order someone thinks in — what, then how much,
 * then how long, then the detail — rather than the order the API happens
 * to list them.
 */
export default function CreateOffer() {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const toast = useToast()

  const [title, setTitle] = useState('')
  const [price, setPrice] = useState('')
  // Minutes. 0 until a length is chosen, which is what keeps the
  // submit button honest about an untouched form.
  const [duration, setDuration] = useState(0)
  const [description, setDescription] = useState('')
  const [submitting, setSubmitting] = useState(false)

  // Every field is required by the backend, so the button says so by
  // staying disabled rather than letting someone submit and be told.
  //
  // A session is paid for and settled one block at a time, so its price
  // has to split into whole blocks. Rather than rejecting the number
  // afterwards, the form says what the nearest workable prices are while
  // it is being typed.
  const priceDrops = Number(price)
  const priceFitsBlocks = priceDrops > 0 && priceDrops % SESSION_BLOCK_COUNT === 0
  const nearestPrices =
    priceDrops > 0 && !priceFitsBlocks
      ? [
          Math.floor(priceDrops / SESSION_BLOCK_COUNT) * SESSION_BLOCK_COUNT,
          Math.ceil(priceDrops / SESSION_BLOCK_COUNT) * SESSION_BLOCK_COUNT,
        ].filter((value) => value > 0)
      : []

  const complete =
    title.trim().length > 0 &&
    description.trim().length > 0 &&
    priceFitsBlocks &&
    // The duration control can only produce a legal value, so there is
    // nothing to check beyond "has one been chosen".
    duration > 0 &&
    duration % STEP_MINUTES === 0

  async function submit() {
    setSubmitting(true)
    try {
      await apiFetch('/offers', {
        method: 'POST',
        body: JSON.stringify({
          price_drops: Number(price),
          session_duration_seconds: duration * 60,
          title: title.trim(),
          description: description.trim(),
        }),
      })
      toast.success(t('offers.createSuccess'))
      navigate('/activity')
    } catch (err) {
      toast.error(formatApiError(err))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="ui-page">
      <PageHeader title={t('offers.createNew')} onBack={() => navigate(-1)} />

      <div className="ui-page-body ui-page-body-action">
        <div className="co-form">
          <label className="ui-field" htmlFor="offer-title">
            <span className="ui-field-label">
              {t('offers.titleLabel')}
              <span className="ui-field-counter">
                {title.length.toLocaleString(i18n.language)} /{' '}
                {TITLE_MAX.toLocaleString(i18n.language)}
              </span>
            </span>
            <input
              id="offer-title"
              className="ui-input"
              value={title}
              maxLength={TITLE_MAX}
              onChange={(event) => setTitle(event.target.value)}
              placeholder={t('offers.titlePlaceholder')}
            />
          </label>

          <DropAmountField
            id="offer-price"
            value={price}
            onChange={setPrice}
            label={t('offers.priceDropsLabel')}
          />
          {/* What the provider actually keeps. Shown here, while they are
              choosing the number, rather than discovered after a sale. */}
          {priceFitsBlocks && <PriceBreakdown priceDrops={priceDrops} audience="provider" />}
          {nearestPrices.length > 0 && (
            <span className="ui-field-help">
              {t('offers.priceMustFitBlocks', {
                blocks: SESSION_BLOCK_COUNT,
                suggestions: nearestPrices
                  .map((value) => value.toLocaleString(i18n.language))
                  .join(' ' + t('common.or') + ' '),
              })}
            </span>
          )}

          <DurationField
            minutes={duration}
            onChange={setDuration}
            blockCount={SESSION_BLOCK_COUNT}
            pricePerBlock={priceFitsBlocks ? priceDrops / SESSION_BLOCK_COUNT : null}
          />

          <label className="ui-field" htmlFor="offer-description">
            <span className="ui-field-label">
              {t('offers.descriptionLabel')}
              <span className="ui-field-counter">
                {description.length.toLocaleString(i18n.language)} /{' '}
                {DESCRIPTION_MAX.toLocaleString(i18n.language)}
              </span>
            </span>
            <textarea
              id="offer-description"
              className="ui-textarea"
              value={description}
              maxLength={DESCRIPTION_MAX}
              onChange={(event) => setDescription(event.target.value)}
              placeholder={t('offers.descriptionPlaceholder')}
            />
          </label>
        </div>
      </div>

      <div className="ui-action-bar">
        <Button
          variant="primary"
          size="lg"
          block
          disabled={!complete}
          loading={submitting}
          onClick={submit}
        >
          {t('offers.createButton')}
        </Button>
      </div>
    </div>
  )
}
