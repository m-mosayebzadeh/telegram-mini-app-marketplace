import { useTranslation } from 'react-i18next'
import { IconMinus, IconPlus } from '../icons'

/**
 * How long a session runs.
 *
 * It used to be a free text box, which let someone type 13 and get four
 * blocks of 3.25 minutes — a number nobody would choose on purpose and
 * that only appeared after they had typed it.
 *
 * Two controls instead, because there are two different moments here:
 * picking a normal length, which should be one tap, and adjusting it,
 * which should not require clearing a field and retyping. The presets
 * are all multiples of the block count, so each one divides into four
 * whole-minute blocks — 60 minutes is four 15-minute blocks, and that
 * reads as something a person decided.
 */

export const STEP_MINUTES = 5
export const MIN_MINUTES = 20
export const MAX_MINUTES = 240

/**
 * Every preset is a multiple of both the 5-minute step and the four
 * blocks a session is split into, so the block length is always a whole
 * number of minutes. A step off a preset stays legal but can land on a
 * fractional block (25 minutes is 6 minutes 15 seconds a block), which
 * the caption then states outright rather than rounding away.
 */
const PRESETS = [20, 40, 60, 80, 120]

interface DurationFieldProps {
  /** Minutes. 0 means nothing chosen yet. */
  minutes: number
  onChange: (minutes: number) => void
  blockCount: number
  /**
   * What one block costs, when the price is far enough along to split.
   * It belongs on this line rather than under the price field: the two
   * numbers together are what the buyer is actually buying, and neither
   * is legible without the other.
   */
  pricePerBlock?: number | null
}

export function DurationField({
  minutes,
  onChange,
  blockCount,
  pricePerBlock,
}: DurationFieldProps) {
  const { t } = useTranslation()

  const clamp = (value: number) => Math.min(MAX_MINUTES, Math.max(MIN_MINUTES, value))
  /** The first tap on either arrow lands on the shortest session there
   *  is, rather than one step off it — "the minimum" is a place someone
   *  might actually want, and stepping DOWN into it from nowhere would
   *  be strange. */
  const step = (delta: number) => onChange(minutes === 0 ? MIN_MINUTES : clamp(minutes + delta))

  return (
    <div className="ui-field">
      <span className="ui-field-label">{t('offers.durationLabel')}</span>

      <div className="ui-chip-rail df-presets">
        {PRESETS.map((preset) => (
          <button
            type="button"
            key={preset}
            className={`ui-chip${minutes === preset ? ' ui-chip-active' : ''}`}
            onClick={() => onChange(preset)}
          >
            {t('offers.minutesShort', { minutes: preset })}
          </button>
        ))}
      </div>

      {/* The fine adjustment. A stepper rather than a text field: the
          value can only ever be legal, so there is no error state to
          design and nothing to reject after the fact. */}
      <div className="df-stepper">
        <button
          type="button"
          className="df-step"
          onClick={() => step(-STEP_MINUTES)}
          disabled={minutes > 0 && minutes <= MIN_MINUTES}
          aria-label={t('offers.durationLess')}
        >
          <IconMinus size={20} />
        </button>

        <span className="df-value tabular" aria-live="polite">
          {minutes > 0 ? t('offers.minutesUnitValue', { minutes }) : t('offers.durationPick')}
        </span>

        <button
          type="button"
          className="df-step"
          onClick={() => step(STEP_MINUTES)}
          disabled={minutes >= MAX_MINUTES}
          aria-label={t('offers.durationMore')}
        >
          <IconPlus size={20} />
        </button>
      </div>

      {/* What the buyer is actually buying. Shown here, while the length
          is being chosen, because the block length is the consequence of
          this number and the only place it can be judged. */}
      <span className="ui-field-help">
        {minutes <= 0
          ? t('offers.durationHint')
          : pricePerBlock
            ? t('offers.blockBreakdown', {
                blocks: blockCount,
                length: formatBlockLength(minutes, blockCount, t),
                price: pricePerBlock,
              })
            : t('offers.blockBreakdownNoPrice', {
                blocks: blockCount,
                length: formatBlockLength(minutes, blockCount, t),
              })}
      </span>
    </div>
  )
}

/**
 * One block's length, in minutes and — only when it does not divide
 * evenly — seconds. "6 دقیقه و ۱۵ ثانیه" is honest where "۶٫۲۵ دقیقه" is
 * a number nobody thinks in.
 */
function formatBlockLength(
  minutes: number,
  blockCount: number,
  t: (key: string, args?: Record<string, unknown>) => string,
): string {
  const totalSeconds = (minutes * 60) / blockCount
  const wholeMinutes = Math.floor(totalSeconds / 60)
  const seconds = Math.round(totalSeconds % 60)

  if (seconds === 0) return t('offers.minutesUnitValue', { minutes: wholeMinutes })
  if (wholeMinutes === 0) return t('offers.secondsUnitValue', { seconds })
  return t('offers.minutesAndSeconds', { minutes: wholeMinutes, seconds })
}
