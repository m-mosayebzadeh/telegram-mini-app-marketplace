/**
 * Navigation `state` a caller can attach when pushing to a page that
 * has its own "back" button, so that button can return to a specific
 * origin explicitly instead of relying on the browser's own history
 * stack (`navigate(-1)`) — which, from the Activity tab's Requests
 * row specifically, doesn't reliably land back on Activity (this is
 * what fixed that real bug report). Every page that supports it reads
 * the exact same shape; add a new value here whenever another origin
 * needs the same explicit-return treatment.
 */
export interface BackNavState {
  backTo?: 'activity-requests'
}
