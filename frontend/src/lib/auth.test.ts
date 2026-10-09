import { describe, expect, it } from 'vitest'
import { forgetWhereYouWere } from './auth'

/** Signing out sends the next sign-in to the world, not back to the page
 *  that was open (the owner's report: Settings, after signing out there). */
describe('signing out', () => {
  it('goes back to the world address', () => {
    window.history.replaceState(null, '', '/settings')
    forgetWhereYouWere()
    expect(window.location.pathname).toBe('/')
  })
})
