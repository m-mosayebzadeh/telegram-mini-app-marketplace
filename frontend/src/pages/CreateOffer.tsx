import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Button, Cell, Input, List, Section, Textarea } from '@telegram-apps/telegram-ui'
import { NumberField } from '../components/NumberField'
import { apiFetch, ApiError } from '../lib/api'

export default function CreateOffer() {
  const { t } = useTranslation()
  const navigate = useNavigate()

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
          description,
        }),
      })
      navigate('/offers/mine')
    } catch (err) {
      setError(err instanceof ApiError ? JSON.stringify(err.body) : String(err))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <List>
      <Section header={t('offers.createNew')}>
        <Cell>
          <NumberField header={t('offers.priceStarsLabel')} value={priceStars} onChange={setPriceStars} />
        </Cell>
        <Cell>
          <Input
            header={t('offers.durationLabel')}
            type="number"
            value={durationMinutes}
            onChange={(e) => setDurationMinutes(e.target.value)}
          />
        </Cell>
        <Cell>
          <Textarea
            header={t('offers.descriptionLabel')}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </Cell>
        {error && <Cell>{error}</Cell>}
        <Cell>
          <Button stretched loading={submitting} onClick={submit}>
            {t('offers.createButton')}
          </Button>
        </Cell>
      </Section>
    </List>
  )
}
