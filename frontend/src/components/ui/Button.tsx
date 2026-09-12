import type { ButtonHTMLAttributes, ReactNode } from 'react'

/**
 * Button — docs/design-system/02-components.md#دکمه
 *
 * The variant is a decision about IMPORTANCE, not about colour: pick the
 * one whose job matches the action, and the colour follows. There is at
 * most one `primary` on a screen.
 */
type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'
type Size = 'lg' | 'md' | 'sm'

interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className'> {
  variant?: Variant
  size?: Size
  /** Full width. The page's own primary action always is. */
  block?: boolean
  /**
   * Swaps the label for a spinner WITHOUT changing the button's size, and
   * stops it responding — a second tap on a submitting form is the most
   * common way to create a duplicate record.
   */
  loading?: boolean
  /** Sits before the label, at 18px. Decorative, so it is never the only
   *  thing that says what the button does. */
  icon?: ReactNode
  children?: ReactNode
}

export function Button({
  variant = 'secondary',
  size = 'md',
  block = false,
  loading = false,
  icon,
  disabled,
  children,
  ...rest
}: ButtonProps) {
  const classes = [
    'ui-btn',
    `ui-btn-${variant}`,
    `ui-btn-${size}`,
    block ? 'ui-btn-block' : '',
    loading ? 'ui-btn-loading' : '',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <button
      className={classes}
      // Still disabled while loading, so the handler cannot fire twice.
      disabled={disabled || loading}
      // A screen reader gets told the button is working; the spinner is
      // only visible feedback.
      aria-busy={loading || undefined}
      {...rest}
    >
      {/* Wrapped in one element because .ui-btn-loading hides the
          button's children to make room for the spinner — the wrapper is
          what keeps the label's width, and with it the button's. */}
      <span className="ui-btn-content">
        {icon}
        {children}
      </span>
    </button>
  )
}

interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className'> {
  /** Required: an icon-only button has no text for a screen reader to
   *  read, so the label has to come from somewhere. */
  label: string
  children: ReactNode
}

/** 44×44 whatever the glyph inside measures. */
export function IconButton({ label, children, ...rest }: IconButtonProps) {
  return (
    <button className="ui-btn ui-btn-icon" aria-label={label} {...rest}>
      {children}
    </button>
  )
}
