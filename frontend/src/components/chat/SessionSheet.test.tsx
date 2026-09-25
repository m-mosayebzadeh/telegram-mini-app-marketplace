import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest'
import { SessionSheet } from './SessionSheet'
import { ChatHeader } from './ChatHeader'
import type { ChatSession } from '../../lib/types'

const mocks = vi.hoisted(() => ({
  t: (key: string, args?: Record<string, unknown>) =>
    args ? `${key} ${JSON.stringify(args)}` : key,
}))
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: mocks.t, i18n: { language: 'en' } }),
}))

function session(overrides: Partial<ChatSession> = {}): ChatSession {
  return {
    id: 1,
    request_id: 1,
    transaction_id: null,
    status: 'open',
    opened_at: '2026-01-01T12:00:00Z',
    closed_at: null,
    closed_by_user_id: null,
    my_role: 'buyer',
    other_participant: { user_id: 2, display_name: 'Bob', username: null, avatar_url: null },
    offer_title: 'A chat about films',
    price_photons: 100,
    session_duration_seconds: 2400,
    reserved_blocks: 4,
    block_duration_seconds: 600,
    block_price_photons: 25,
    started_at: null,
    ends_at: null,
    close_at_block_end_by_user_id: null,
    i_asked_to_stop: false,
    can_stop_at_block_end: false,
    extension_pending: false,
    can_request_extension: false,
    consumed_blocks: 0,
    end_reason: null,
    i_confirmed_settlement: false,
    they_confirmed_settlement: false,
    disputed: false,
    transaction_status: null,
    archived: false,
    ...overrides,
  } as ChatSession
}

let root: Root
let container: HTMLDivElement

const noop = () => {}

async function renderSheet(value: ChatSession, canDispute = false) {
  await act(async () => {
    root.render(
      <SessionSheet
        session={value}
        viewerId={1}
        onClose={noop}
        onRequestEnd={noop}
        onDispute={noop}
        onReport={noop}
        onBlock={noop}
        canDispute={canDispute}
      />,
    )
  })
}

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

describe('SessionSheet', () => {
  it('never prints a raw translation key for a session with no transaction', async () => {
    // A running session has no transaction at all — money is reserved,
    // not spent — and the screen used to render
    // "chatSession.transactionStatus.null" at people.
    await renderSheet(session())

    expect(document.body.textContent).not.toContain('transactionStatus.null')
    expect(document.body.textContent).toContain('chatSession.settlementNotYet')
  })

  it('says nothing was used when a session closed without consuming a block', async () => {
    await renderSheet(session({ status: 'closed', transaction_status: null, consumed_blocks: 0 }))

    expect(document.body.textContent).toContain('chatSession.settlementNothingOwed')
  })

  it('states the session length in minutes, not the raw seconds', async () => {
    // The label said minutes and the value was 2400.
    await renderSheet(session())

    expect(document.body.textContent).toContain('"minutes":40')
    expect(document.body.textContent).not.toContain('2400')
  })

  it('spells the price out as blocks', async () => {
    await renderSheet(session())

    expect(document.body.textContent).toContain('"blocks":4')
    expect(document.body.textContent).toContain('"photons":25')
  })

  it('makes ending the session a danger action, never the filled one', async () => {
    await renderSheet(session())

    const end = document.querySelector('.cs-end .ui-btn')
    expect(end?.className).toContain('ui-btn-danger')
    // Nothing in this sheet is the accent-filled primary: none of it is
    // what someone opened it to do.
    expect(document.querySelectorAll('.ui-btn-primary')).toHaveLength(0)
  })

  it('offers no way to end a session that has already ended', async () => {
    await renderSheet(session({ status: 'closed', closed_by_user_id: 1 }))

    expect(document.body.textContent).not.toContain('chatSession.closeButton')
    expect(document.body.textContent).toContain('chatSession.closedByYou')
  })

  it('holds blocking back until the money is settled', async () => {
    await renderSheet(session())
    const blockRow = [...document.querySelectorAll<HTMLButtonElement>('.cs-actions .ui-row')].at(-1)!
    expect(blockRow.disabled).toBe(true)
    expect(blockRow.textContent).toContain('chatSession.blockDisabledHint')

    await renderSheet(session({ status: 'closed' }))
    const afterClose = [...document.querySelectorAll<HTMLButtonElement>('.cs-actions .ui-row')].at(-1)!
    expect(afterClose.disabled).toBe(false)
  })
})

describe('ChatHeader', () => {
  async function renderHeader(value: ChatSession) {
    await act(async () => {
      root.render(
        <ChatHeader session={value} onBack={noop} onOpenDetails={noop} onOpenProfile={noop} />,
      )
    })
  }

  it('carries no clock of its own', async () => {
    // Time belongs to the block bar directly below, which shows it
    // against the blocks it is spending. A second clock here was both a
    // duplicate and, before the session started, a lie.
    await renderHeader(session())

    expect(container.textContent).not.toMatch(/\d\d:\d\d/)
  })

  it('says the state as a caption rather than a coloured pill', async () => {
    await renderHeader(session())

    expect(container.querySelector('.ch-state')?.textContent).toBe('chatSession.statusOpen')
    expect(container.querySelector('.ch-state-alert')).toBeNull()
  })

  it('marks a disputed session, which is the one state that is not ordinary', async () => {
    await renderHeader(session({ disputed: true }))

    expect(container.querySelector('.ch-state-alert')?.textContent).toBe(
      'chatSession.statusDisputed',
    )
  })

  it('is down to three controls from six', async () => {
    // Back, the person, and one way in to everything about the session.
    // It used to be back + identity + a status pill + a timer + a
    // details chevron + an overflow, all inside 56 pixels.
    await renderHeader(session())

    const buttons = container.querySelectorAll('.ch-header > button')
    expect(buttons).toHaveLength(3)
  })
})
