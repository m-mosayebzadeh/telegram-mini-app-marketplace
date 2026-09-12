/**
 * The design system's React layer. Pages import from here, never from a
 * file inside it — so a component can move or be split without every
 * caller having to change.
 *
 * Everything here is built from docs/design-system/ and reads semantic
 * tokens only. A page that needs something this layer does not have adds
 * it HERE first, with a note in 02-components.md saying what job it does.
 */

export { Button, IconButton } from './Button'
export { ConfirmDialog } from './ConfirmDialog'
export { PageHeader } from './PageHeader'
export { Sheet } from './Sheet'
export { EmptyState, ErrorState, SkeletonRows, SkeletonCards } from './States'
export { ToastProvider, useToast } from './Toast'
