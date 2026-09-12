import type { ReactNode } from 'react'
import { IconChevron } from '../icons'

interface NavRowProps {
  title: string
  /** One line under the title, saying what is behind the row when the
   *  title alone does not. Never filler. */
  subtitle?: string
  /** 20px, leading. A section marker, not decoration — a row with an
   *  icon nobody can name is a row with a smudge on it. */
  icon?: ReactNode
  /** The row's current value, or a count. Sits before the chevron. */
  value?: ReactNode
  onClick: () => void
  disabled?: boolean
}

/**
 * A list row that leads somewhere.
 *
 * The chevron is the whole point: it is the difference between a row you
 * can tap and a row that is only text, and it is what stops a list of
 * destinations from reading like a list of facts. It mirrors under RTL,
 * because "onward" is whichever way the language runs.
 */
export function NavRow({ title, subtitle, icon, value, onClick, disabled }: NavRowProps) {
  return (
    <button type="button" className="ui-row" onClick={onClick} disabled={disabled}>
      {icon && <span className="ui-row-media ui-row-media-plain">{icon}</span>}
      <span className="ui-row-main">
        <span className="ui-row-title">{title}</span>
        {subtitle && <span className="ui-row-subtitle">{subtitle}</span>}
      </span>
      <span className="ui-row-trailing">
        {value}
        <IconChevron size={20} className="ui-row-chevron" />
      </span>
    </button>
  )
}
