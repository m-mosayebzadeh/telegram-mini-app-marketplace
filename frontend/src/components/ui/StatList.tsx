import type { ReactNode } from 'react'

export interface Stat {
  label: string
  /** Already formatted for display — this component never decides how a
   *  number, a date or a percentage should read. */
  value: ReactNode
  /** One line under the value, for a figure that needs a caveat. */
  note?: string
}

/**
 * A short table of facts about one thing — a provider's record, a
 * buyer's history.
 *
 * This is the one shape in the product where a label/value table is the
 * right answer rather than a smell: every row is the same KIND of
 * statement about the same subject, so a reader scans the labels down
 * one column and the figures down the other. A list of unrelated rows
 * would not earn it.
 */
export function StatList({ stats }: { stats: Stat[] }) {
  return (
    <dl className="ui-stats">
      {stats.map((stat) => (
        <div className="ui-stat-row" key={stat.label}>
          <dt className="ui-stat-label">{stat.label}</dt>
          <dd className="ui-stat-value tabular">{stat.value}</dd>
          {stat.note && <p className="ui-stat-note">{stat.note}</p>}
        </div>
      ))}
    </dl>
  )
}
