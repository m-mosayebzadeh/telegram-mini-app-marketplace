import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from './Button'

/**
 * The four mandatory states — docs/design-system/02-components.md#حالت‌ها
 *
 * Every surface that fetches data owes the user all four. A state nobody
 * designed is exactly where a product stops feeling finished.
 */

interface EmptyStateProps {
  icon?: ReactNode
  title: string
  /**
   * Say WHY it is empty. The user can already see that it is — "there is
   * nothing here" tells them nothing they did not know, and leaves them
   * with nowhere to go.
   */
  text: string
  /** The way forward. An empty state without one is a dead end. */
  actionLabel?: string
  onAction?: () => void
}

export function EmptyState({ icon, title, text, actionLabel, onAction }: EmptyStateProps) {
  return (
    <div className="ui-state">
      {icon && <div className="ui-state-icon">{icon}</div>}
      <h2 className="ui-state-title">{title}</h2>
      <p className="ui-state-text">{text}</p>
      {actionLabel && onAction && (
        <div className="ui-state-action">
          <Button variant="primary" onClick={onAction}>
            {actionLabel}
          </Button>
        </div>
      )}
    </div>
  )
}

interface ErrorStateProps {
  /** What actually happened, in the user's terms. Falls back to the
   *  generic message when the failure has nothing useful to say. */
  text?: string
  onRetry?: () => void
}

/**
 * Same shape as the empty state, because to the user these are the same
 * moment: nothing is here, and here is what to do about it. The
 * difference is that this one is recoverable, so it always offers retry.
 */
export function ErrorState({ text, onRetry }: ErrorStateProps) {
  const { t } = useTranslation()
  return (
    <div className="ui-state">
      <h2 className="ui-state-title">{t('common.error')}</h2>
      {text && <p className="ui-state-text">{text}</p>}
      {onRetry && (
        <div className="ui-state-action">
          <Button variant="secondary" onClick={onRetry}>
            {t('common.retry')}
          </Button>
        </div>
      )}
    </div>
  )
}

/**
 * A skeleton stands in the place the content will occupy and takes its
 * shape, so nothing jumps when the data lands. Never a full-screen
 * spinner: a spinner says "wait" and nothing more.
 */
export function SkeletonRows({ count = 4 }: { count?: number }) {
  return (
    <div aria-busy="true" aria-live="polite">
      {Array.from({ length: count }, (_, index) => (
        <div className="ui-skeleton-row" key={index}>
          <div className="ui-skeleton ui-skeleton-avatar" />
          <div className="ui-skeleton-row-main">
            <div className="ui-skeleton ui-skeleton-title" />
            <div className="ui-skeleton ui-skeleton-text" style={{ width: '70%' }} />
          </div>
        </div>
      ))}
    </div>
  )
}

/** For a grid of person cards — same 4:5 frame as the real card. */
export function SkeletonCards({ count = 4 }: { count?: number }) {
  return (
    <>
      {Array.from({ length: count }, (_, index) => (
        <div className="ui-skeleton ui-skeleton-card" key={index} />
      ))}
    </>
  )
}
