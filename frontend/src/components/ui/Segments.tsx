import { useTranslation } from 'react-i18next'

export interface SegmentOption<T extends string> {
  id: T
  label: string
  /**
   * Unseen items behind this segment. Zero renders nothing at all —
   * never a "0" badge, which is a number with nothing to say.
   */
  count?: number
}

interface SegmentsProps<T extends string> {
  options: SegmentOption<T>[]
  value: T
  onChange: (id: T) => void
  /** Names the group for a screen reader: "what are these segments of?" */
  label: string
}

/**
 * In-page segments — two or three views of the SAME page.
 *
 * Not the bottom nav (that moves between destinations) and not a filter
 * chip (that narrows one list). The underline treatment is what says so:
 * you are still on one page, looking at part of it.
 */
export function Segments<T extends string>({ options, value, onChange, label }: SegmentsProps<T>) {
  const { i18n } = useTranslation()

  return (
    <div className="ui-segments" role="tablist" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          role="tab"
          aria-selected={option.id === value}
          className={`ui-segment${option.id === value ? ' ui-segment-active' : ''}`}
          onClick={() => onChange(option.id)}
        >
          {option.label}
          {!!option.count && (
            <span className="ui-badge">{option.count.toLocaleString(i18n.language)}</span>
          )}
        </button>
      ))}
    </div>
  )
}
