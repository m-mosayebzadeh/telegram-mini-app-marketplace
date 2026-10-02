import { describe, expect, it } from 'vitest'
import { nextDelay } from './echoStore'
import type { EchoStatus } from './echoApi'

const base = { open_now: true, minutes_until_open: null, missing: [], suspended: false, waiting: false, waiting_since: null, matched: null, last_search: null, remaining_today: null } as EchoStatus

/** Echo asks the server on no clock but the ones that are events of their
 *  own (section 32). */
describe('when Echo asks the server by itself', () => {
  it('never while simply waiting', () => {
    expect(nextDelay({ ...base, waiting: true })).toBeNull()
  })

  it('at a card\'s deadline, which is what settles it', () => {
    const expires_at = new Date(Date.now() + 10_000).toISOString()
    const delay = nextDelay({ ...base, proposal: { id: 1, tagline: null, shared_tags: [], expires_at, seconds: 30, accepted: false } })
    expect(delay).toBeGreaterThan(9_000)
    expect(delay).toBeLessThan(11_000)
  })

  it('at the minute Echo shuts, or opens', () => {
    expect(nextDelay({ ...base, minutes_until_close: 2 })).toBeGreaterThanOrEqual(120_000)
    expect(nextDelay({ ...base, open_now: false, minutes_until_open: 5 })).toBeGreaterThanOrEqual(300_000)
  })
})
