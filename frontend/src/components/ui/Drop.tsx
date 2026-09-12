import { IconDrop } from '../icons'

interface DropChipProps {
  amount: number
  /** The active i18n language, so Persian digits appear under fa and
   *  Latin ones under en without either page hard-coding a locale. */
  locale: string
  onClick?: () => void
  /** Required when the chip is a button: the number alone tells a screen
   *  reader nothing about what it counts. */
  label?: string
}

/**
 * The Drop balance chip — docs/design-system/02-components.md#چیپ-و-بج
 *
 * Sits in the trailing slot of every tab root's header. Two jobs at
 * once: it says what the balance is, and it is the way into the wallet,
 * which is why the wallet is not a fifth tab.
 */
export function DropChip({ amount, locale, onClick, label }: DropChipProps) {
  const content = (
    <>
      <IconDrop size={16} />
      {amount.toLocaleString(locale)}
    </>
  )

  if (!onClick) {
    return <span className="ui-drop tabular">{content}</span>
  }

  return (
    <button type="button" className="ui-drop tabular" onClick={onClick} aria-label={label}>
      {content}
    </button>
  )
}

interface DropAmountProps {
  amount: number
  locale: string
  /** 16 in a chip or a row, 18 beside body text, 24 in a page's headline
   *  figure. Below 20 the mark drops its flame core — see IconDrop. */
  size?: 16 | 18 | 24
}

/**
 * A Drop figure in running content: the mark beside the number, never
 * instead of it. Isolated for direction so a Latin numeral inside a
 * Persian sentence does not drag the surrounding words around with it.
 */
export function DropAmount({ amount, locale, size = 18 }: DropAmountProps) {
  return (
    <span className="ui-drop-amount tabular">
      <IconDrop size={size} />
      <bdi>{amount.toLocaleString(locale)}</bdi>
    </span>
  )
}
