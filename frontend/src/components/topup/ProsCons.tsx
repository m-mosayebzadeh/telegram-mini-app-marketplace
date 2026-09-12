import { IconCheck, IconClose } from '../icons'

interface ProsConsProps {
  /** Already-translated lines. Pros first — someone comparing three ways
   *  to pay wants to know what each one is good for before what it costs
   *  them. */
  pros?: string[]
  cons?: string[]
}

/**
 * What a top-up method is good and bad at, as a short list.
 *
 * This is the only place in the product where a screen argues a case,
 * and it earns its space: the three methods differ in ways money is
 * involved — one is instant but freezes funds, one is cheap but takes an
 * hour — and a user picking blind will pick wrong.
 *
 * The marks used to be the text characters ✓ and ✕, which take no
 * stroke width, no size and no alignment from anything around them.
 */
export function ProsCons({ pros = [], cons = [] }: ProsConsProps) {
  return (
    <ul className="tu-proscons">
      {pros.map((line) => (
        <li className="tu-pro" key={line}>
          <IconCheck size={18} />
          <span>{line}</span>
        </li>
      ))}
      {cons.map((line) => (
        <li className="tu-con" key={line}>
          <IconClose size={18} />
          <span>{line}</span>
        </li>
      ))}
    </ul>
  )
}
