/**
 * "The person came back to the app" (section 32): the tab or app became
 * visible again. The one moment the app asks the server for fresh state
 * of its own accord. Everything else arrives as a live event the moment
 * it happens; nothing in the app asks on a clock.
 *
 * Returns the unsubscribe.
 */
export function onReturn(callback: () => void): () => void {
  const handler = () => {
    if (document.visibilityState === 'visible') callback()
  }
  document.addEventListener('visibilitychange', handler)
  return () => document.removeEventListener('visibilitychange', handler)
}
