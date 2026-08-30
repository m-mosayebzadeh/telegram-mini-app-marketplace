import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Input, Textarea } from '@telegram-apps/telegram-ui'
import { PriceBreakdown } from '../components/PriceBreakdown'
import { NumberField } from '../components/NumberField'
import { apiFetch, formatApiError } from '../lib/api'

export default function CreateOffer() {
  const { t } = useTranslation()
  const navigate = useNavigate()

  const [title, setTitle] = useState('')
  const [priceStars, setPriceStars] = useState('')
  const [durationMinutes, setDurationMinutes] = useState('')
  const [description, setDescription] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function submit() {
    setError(null)
    setSubmitting(true)
    try {
      await apiFetch('/offers', {
        method: 'POST',
        body: JSON.stringify({
          price_stars: Number(priceStars),
          display_duration_minutes: Number(durationMinutes),
          title,
          description,
        }),
      })
      navigate('/activity')
    } catch (err) {
      setError(formatApiError(err))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="hp-page">
      <div className="hp-page-header">{t('offers.createNew')}</div>

      <div className="hp-card">
        <div className="hp-field">
          <Input header={t('offers.titleLabel')} value={title} onChange={(e) => setTitle(e.target.value)} />
        </div>
        <div className="hp-field">
          <NumberField header={t('offers.priceStarsLabel')} value={priceStars} onChange={setPriceStars} />
        </div>
        {/* Live preview — updates as the price above changes. Offers are
            chat-only for now, so commissionKind is always 'chat' here;
            see components/PriceBreakdown.tsx for why it still takes the
            kind explicitly rather than hardcoding it internally. */}
        <PriceBreakdown priceStars={Number(priceStars) || 0} commissionKind="chat" />
        <div className="hp-field">
          <Input
            header={t('offers.durationLabel')}
            type="number"
            value={durationMinutes}
            onChange={(e) => setDurationMinutes(e.target.value)}
          />
        </div>
        <div className="hp-field">
          <Textarea
            header={t('offers.descriptionLabel')}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>

        {error && <p className="hp-error">{error}</p>}

        <div className="hp-field">
          <button
            className="hp-btn hp-btn-gradient"
            style={{ width: '100%' }}
            disabled={submitting}
            onClick={submit}
          >
            {submitting ? t('common.loading') : t('offers.createButton')}
          </button>
        </div>
      </div>
    </div>
  )
}
