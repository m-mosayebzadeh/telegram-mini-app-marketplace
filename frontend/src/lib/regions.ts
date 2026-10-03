/**
 * The regions of the world, read from the address (sections 30.5-30.8).
 *
 * Kept apart from pages/Sky.tsx so that file exports only the component: the
 * development server can then swap the component in place on every save
 * instead of reloading the whole app.
 */

/**
 * The regions of the world (TECHNICAL_REQUIREMENTS.md sections 30.5–30.8).
 *
 * Conversations and news are not other pages: they happen IN the world —
 * the people you talk to are pulled out of it towards you, news arrives
 * out of a wormhole above it. Each still has an address of its own, so
 * the phone's back button leaves a region the way people expect, and a
 * link can open one directly.
 */
export type Region = 'world' | 'talk' | 'news'
export function regionOf(param: string | undefined): Region {
  return param === 'talk' || param === 'news' ? param : 'world'
}
