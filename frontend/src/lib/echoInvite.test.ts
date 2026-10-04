import { describe, expect, it } from 'vitest'
import { inviteLine } from './echoInvite'
import type { EchoStatus } from './echoApi'

const echo = (over: Partial<EchoStatus>) => ({ open_now: true, waiting_now: 0, show_counts: true, ...over }) as EchoStatus

/** The newcomer's invitation says Echo's real state (section 32). */
describe("the newcomer's invitation to Echo", () => {
  it('says how many are waiting when Echo is open and somebody is', () => {
    expect(inviteLine(echo({ waiting_now: 3 }))).toEqual({ key: 'week.emptyWaiting', count: 3 })
  })

  it('keeps the plain sentence when nobody is waiting, or numbers are hidden in the panel', () => {
    expect(inviteLine(echo({ waiting_now: 0 })).key).toBe('week.emptyText')
    expect(inviteLine(echo({ waiting_now: 4, show_counts: false })).key).toBe('week.emptyText')
  })

  it('says plainly when Echo is shut, rather than promising somebody now', () => {
    expect(inviteLine(echo({ open_now: false, waiting_now: 5 })).key).toBe('week.emptyShut')
    expect(inviteLine(null).key).toBe('week.emptyShut')
  })
})
