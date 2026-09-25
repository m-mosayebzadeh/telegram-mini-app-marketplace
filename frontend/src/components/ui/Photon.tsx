import { IconPhoton } from '../icons'

interface PhotonChipProps {
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
 * The Photon balance chip — docs/design-system/02-components.md#چیپ-و-بج
 *
 * Sits in the trailing slot of every tab root's header. Two jobs at
 * once: it says what the balance is, and it is the way into the wallet,
 * which is why the wallet is not a fifth tab.
 */
export function PhotonChip({ amount, locale, onClick, label }: PhotonChipProps) {
  const content = (
    <>
      <IconPhoton size={16} />
      {amount.toLocaleString(locale)}
    </>
  )

  if (!onClick) {
    return <span className="ui-photon tabular">{content}</span>
  }

  return (
    <button type="button" className="ui-photon tabular" onClick={onClick} aria-label={label}>
      {content}
    </button>
  )
}

interface PhotonAmountProps {
  amount: number
  locale: string
  /** 16 in a chip or a row, 18 beside body text, 24 in a page's headline
   *  figure. Below 20 the mark loses its highlight — see IconPhoton. */
  size?: 16 | 18 | 24
}

/**
 * A Photon figure in running content: the mark beside the number, never
 * instead of it. Isolated for direction so a Latin numeral inside a
 * Persian sentence does not drag the surrounding words around with it.
 */
export function PhotonAmount({ amount, locale, size = 18 }: PhotonAmountProps) {
  return (
    <span className="ui-photon-amount tabular">
      <IconPhoton size={size} />
      <bdi>{amount.toLocaleString(locale)}</bdi>
    </span>
  )
}
