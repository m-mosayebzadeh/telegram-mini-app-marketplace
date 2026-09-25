import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest'
import { BlockBar } from './BlockBar'
import type { ChatSession } from '../../lib/types'

const mocks = vi.hoisted(() => ({
  t: (key: string, args?: Record<string, unknown>) =>
    args ? `${key} ${JSON.stringify(args)}` : key,
}))
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: mocks.t, i18n: { language: 'en' } }),
}))

const START = new Date('2026-01-01T12:00:00Z')
/** Four blocks of 10 minutes at 25 Photons each — a 40-minute, 100-Photon
 *  session, which is one of the offered presets. */
const BLOCK_MS = 10 * 60 * 1000

function session(overrides: Partial<ChatSession> = {}): ChatSession {
  return {
    id: 1,
    request_id: 1,
    transaction_id: null,
    status: 'open',
    opened_at: START.toISOString(),
    closed_at: null,
    closed_by_user_id: null,
    my_role: 'buyer',
    other_participant: { user_id: 2, display_name: 'Alice', username: null, avatar_url: null },
    offer_title: 'Chat',
    price_photons: 100,
    session_duration_seconds: 2400,
    reserved_blocks: 4,
    block_duration_seconds: 600,
    block_price_photons: 25,
    started_at: START.toISOString(),
    ends_at: new Date(START.getTime() + 4 * BLOCK_MS).toISOString(),
    close_at_block_end_by_user_id: null,
    i_asked_to_stop: false,
    can_stop_at_block_end: true,
    extension_pending: false,
    can_request_extension: false,
    consumed_blocks: 0,
    end_reason: null,
    i_confirmed_settlement: false,
    they_confirmed_settlement: false,
    disputed: false,
    transaction_status: 'succeeded',
    archived: false,
    ...overrides,
  } as ChatSession
}

let root: Root
let container: HTMLDivElement

async function render(value: ChatSession) {
  await act(async () => {
    root.render(<BlockBar session={value} onOpenDetails={() => {}} />)
  })
}

const blocks = () => [...container.querySelectorAll('.bb-block')]
const spent = () => container.querySelectorAll('.bb-block-spent').length

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(START)
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.useRealTimers()
})

describe('BlockBar', () => {
  it('draws one segment per reserved block', async () => {
    await render(session())
    expect(blocks()).toHaveLength(4)
  })

  it('fills a segment as each block is consumed', async () => {
    await render(session())
    expect(spent()).toBe(0)

    // Blocks advance on wall-clock time, not on who is connected — which
    // is what makes this arithmetic rather than a subscription.
    vi.setSystemTime(new Date(START.getTime() + 2.5 * BLOCK_MS))
    await act(async () => {
      vi.advanceTimersByTime(1000)
    })

    expect(spent()).toBe(2)
  })

  it('marks the block currently running, and only that one', async () => {
    await render(session())
    expect(container.querySelectorAll('.bb-block-live')).toHaveLength(1)
    expect(blocks()[0].className).toContain('bb-block-live')
  })

  it('says which block you are in, which the shape alone cannot', async () => {
    // A row of segments does not tell anyone which end is the start,
    // which way it fills, or which one is running now.
    await render(session())

    expect(container.querySelector('.bb-position')?.textContent).toContain(
      '"current":1,"total":4',
    )
  })

  it('leads with the time left and never puts the money on the bar', async () => {
    await render(session())

    expect(container.querySelector('.bb-time')?.textContent).toContain('chatSession.remaining')
    // A figure that climbs during an intimate conversation reads as a
    // taxi meter, which is directly against what this product is.
    expect(container.querySelector('.bb-amount')).toBeNull()
  })

  it('shows the amount as a block turns over, then takes it away', async () => {
    await render(session())
    expect(container.querySelector('.bb-amount')).toBeNull()

    vi.setSystemTime(new Date(START.getTime() + BLOCK_MS))
    await act(async () => {
      vi.advanceTimersByTime(1000)
    })
    expect(container.querySelector('.bb-amount')?.textContent).toContain('"photons":25')

    // Four seconds, then gone: an event, not a readout.
    await act(async () => {
      vi.advanceTimersByTime(4000)
    })
    expect(container.querySelector('.bb-amount')).toBeNull()
  })

  it('does not flash an amount at someone who just reopened a session', async () => {
    // The first value a session renders with is not a change. Walking
    // back into a conversation half-way through must not look like a
    // block just turned over.
    await render(session({ started_at: new Date(START.getTime() - 2 * BLOCK_MS).toISOString() }))

    expect(container.querySelector('.bb-amount')).toBeNull()
  })

  it('says the session has not started rather than counting down', async () => {
    await render(session({ started_at: null }))

    // The position slot carries it: "which block" has no answer yet, so
    // that is where "not started" belongs, not in the time slot.
    expect(container.querySelector('.bb-position')?.textContent).toBe(
      'chatSession.notStartedShort',
    )
    expect(container.querySelector('.bb-time')?.textContent).toBe('')
    expect(spent()).toBe(0)
    // Nothing is running, so nothing is marked as running.
    expect(container.querySelectorAll('.bb-block-live')).toHaveLength(0)
  })

  it('freezes where it stopped once the session is closed', async () => {
    await render(
      session({
        status: 'closed',
        consumed_blocks: 2,
        closed_at: new Date(START.getTime() + 2 * BLOCK_MS).toISOString(),
      }),
    )

    expect(spent()).toBe(2)
    expect(container.querySelectorAll('.bb-block-live')).toHaveLength(0)

    // And it does not keep ticking on an archived conversation.
    vi.setSystemTime(new Date(START.getTime() + 10 * BLOCK_MS))
    await act(async () => {
      vi.advanceTimersByTime(5000)
    })
    expect(spent()).toBe(2)
  })
})
