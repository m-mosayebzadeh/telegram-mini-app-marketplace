import { describe, expect, it } from 'vitest'
import { ApiError, apiReason } from './api'

/** A refusal's reason, so screens say it in words (the owner saw raw JSON). */
describe('reading why a request was refused', () => {
  it('finds the reason in a structured refusal', () => {
    const err = new ApiError(429, { detail: { reason: 'daily_new_people_limit', limit: 10 } })
    expect(apiReason(err)).toBe('daily_new_people_limit')
  })

  it('has nothing to say about a plain-text refusal', () => {
    expect(apiReason(new ApiError(400, { detail: 'Only a pending request can be accepted.' }))).toBeUndefined()
  })

  it('has nothing to say about an error that is not the server’s', () => {
    expect(apiReason(new Error('offline'))).toBeUndefined()
  })
})
