import { useEffect, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { IconArrowNarrowLeft } from '../icons'

interface PageHeaderProps {
  title: string
  /**
   * Present on an inner page, absent on a tab root. Passing it is what
   * makes this "a screen you came into"; a tab root is the top of its
   * own stack and has nowhere to go back to.
   *
   * It must return the previous screen's scroll position and state — a
   * back that reloads the list from the top is a back that punishes the
   * user for looking at something.
   */
  onBack?: () => void
  /** The trailing slot: a settings button on a tab root, an overflow
   *  action on an inner page, the Drop balance chip on a tab root. */
  action?: ReactNode
}

/**
 * Header — docs/design-system/02-components.md#هدر
 *
 * The product's ONE header. The audit that started this redesign found
 * four different ones, which means a user has to learn where things are
 * four times. There is no second pattern, and no page without a header.
 */
export function PageHeader({ title, onBack, action }: PageHeaderProps) {
  const { t } = useTranslation()
  const isRoot = !onBack
  const scrolled = useScrolled()

  const classes = [
    'ui-header',
    isRoot ? 'ui-header-root' : '',
    // The bottom rule appears only once content has actually gone under
    // the header. A permanent line is one more thing to look past on
    // every screen.
    scrolled ? 'ui-header-scrolled' : '',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <header className={classes}>
      {onBack ? (
        <button
          className="ui-header-slot ui-header-back"
          onClick={onBack}
          aria-label={t('common.back')}
        >
          <IconArrowNarrowLeft size={22} />
        </button>
      ) : (
        // Both edges reserve their width whether or not they hold
        // anything, so the title does not shift between screens.
        <span className="ui-header-slot" aria-hidden="true" />
      )}

      <h1 className="ui-header-title">{title}</h1>

      <span className="ui-header-slot">{action}</span>
    </header>
  )
}

/** True once the page has scrolled far enough that content is passing
 *  behind the header. */
function useScrolled(threshold = 4) {
  const [scrolled, setScrolled] = useState(false)

  useEffect(() => {
    function onScroll() {
      setScrolled(window.scrollY > threshold)
    }
    onScroll()
    // Passive: this listener never calls preventDefault, and saying so
    // keeps it off the scrolling critical path on touch devices.
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [threshold])

  return scrolled
}
