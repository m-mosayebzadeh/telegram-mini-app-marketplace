import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest'
import { Keepsake, ThreadDeal } from './ThreadDeal'
import type { Deal } from '../../lib/deal'
import type { ChatSession, RequestActivity } from '../../lib/types'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
}))

const api = vi.hoisted(() => ({
  confirmRequest: vi.fn(async () => ({})),
  refuseRequest: vi.fn(async () => ({})),
  withdrawRequest: vi.fn(async () => ({})),
  payRequest: vi.fn(async () => ({})),
  releaseSession: vi.fn(async () => ({})),
  stopAtBlockEnd: vi.fn(async () => ({})),
  keepGoing: vi.fn(async () => ({})),
  askOneMoreBlock: vi.fn(async () => ({})),
  acceptOneMoreBlock: vi.fn(async () => ({})),
  declineOneMoreBlock: vi.fn(async () => ({})),
  sendThanks: vi.fn(async () => ({})),
}))
vi.mock('../../lib/worldApi', async (original) => ({
  ...(await original<typeof import('../../lib/worldApi')>()),
  ...api,
}))

/**
 * What the conversation with one person shows besides messages
 * (TECHNICAL_REQUIREMENTS.md sections 30.15–30.18).
 */
describe('the deal inside a conversation', () => {
  let host: HTMLDivElement
  let root: Root

  beforeEach(() => {
    Object.values(api).forEach((fn) => fn.mockClear())
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
  })
  afterEach(() => {
    act(() => root.unmount())
    host.remove()
  })

  const person = { user_id: 2, display_name: 'Sara', username: null, avatar_url: null }
  const session = (over: Partial<ChatSession> = {}): ChatSession =>
    ({
      id: 9, request_id: 1, transaction_id: null, status: 'closed', opened_at: '2026-09-01T12:00:00Z',
      closed_at: '2026-09-01T12:30:00Z', closed_by_user_id: null, my_role: 'buyer', other_participant: person,
      offer_title: 'Books', price_photons: 240, session_duration_seconds: 1800, reserved_blocks: 4,
      block_duration_seconds: 450, block_price_photons: 60, started_at: new Date().toISOString(),
      ends_at: new Date(Date.now() + 1_800_000).toISOString(), close_at_block_end_by_user_id: null,
      i_asked_to_stop: false, can_stop_at_block_end: true, extension_pending: false, can_request_extension: false,
      consumed_blocks: 3, end_reason: 'completed', i_confirmed_settlement: false, they_confirmed_settlement: false,
      disputed: false, transaction_status: 'pending', archived: false, ...over,
    }) as ChatSession
  const request = (over: Partial<RequestActivity> = {}): RequestActivity => ({
    id: 5, offer_id: 1, offer_title: 'Books', offer_price_photons: 120, status: 'pending', reason: null,
    created_at: '2026-09-01T11:00:00Z', responded_at: null, direction: 'received', counterpart_user_id: 2,
    counterpart_display_name: 'Sara', counterpart_username: null, counterpart_avatar_url: null, ...over,
  })

  function render(deal: Deal) {
    const changed = vi.fn()
    act(() => root.render(<ThreadDeal deal={deal} name="Sara" onChanged={changed} />))
    return changed
  }
  const buttons = () => [...host.querySelectorAll('button')]
  const button = (text: string) => buttons().find((b) => b.textContent === text)
  const press = async (text: string) => {
    const b = button(text)
    expect(b, `a button saying ${text}`).toBeDefined()
    await act(async () => { b!.click() })
  }

  it('lets the offerer confirm or refuse an acceptance of their offer', async () => {
    const changed = render({ kind: 'request', stage: 'received', request: request() })
    await press('deal.request.confirm')
    expect(api.confirmRequest).toHaveBeenCalledWith(5)
    expect(changed).toHaveBeenCalled()
  })

  it('asks once more before a request is taken back', async () => {
    render({ kind: 'request', stage: 'sent', request: request({ direction: 'sent' }) })
    await press('deal.request.withdraw')
    expect(api.withdrawRequest).not.toHaveBeenCalled()
    await press('deal.request.withdrawSure')
    expect(api.withdrawRequest).toHaveBeenCalledWith(5)
  })

  it('offers paying only to the requester whose acceptance was confirmed', async () => {
    render({ kind: 'request', stage: 'accepted', request: request({ direction: 'sent', status: 'accepted' }) })
    await press('deal.request.pay')
    expect(api.payRequest).toHaveBeenCalledWith(5)
    act(() => root.render(<ThreadDeal deal={{ kind: 'request', stage: 'awaitpay', request: request({ status: 'accepted' }) }} name="Sara" onChanged={() => {}} />))
    expect(buttons()).toHaveLength(0)
  })

  it('releases Photons only on the second tap, and then says they were sent', async () => {
    render({ kind: 'ending', session: session(), held: 180, refunded: 60 })
    expect(host.textContent).toContain('deal.ending.refunded')
    await press('deal.ending.release')
    expect(api.releaseSession).not.toHaveBeenCalled()
    await press('deal.ending.releaseSure')
    expect(api.releaseSession).toHaveBeenCalledWith(9)
    expect(host.textContent).toContain('deal.ending.released')
  })

  it('never puts a complaint button beside release', () => {
    render({ kind: 'ending', session: session(), held: 180, refunded: 0 })
    expect(buttons().map((b) => b.textContent)).toEqual(['deal.ending.release'])
    expect(host.textContent).toContain('deal.ending.note')
  })

  it('tells the offerer the Photons are held, with nothing to press', () => {
    render({ kind: 'ending', session: session({ my_role: 'provider' }), held: 180, refunded: 60 })
    expect(host.textContent).toContain('deal.ending.heldForYou')
    // The refund is the requester's news, not the offerer's.
    expect(host.textContent).not.toContain('deal.ending.refunded')
    expect(buttons()).toHaveLength(0)
  })

  it('says truthfully who ended a session early', () => {
    render({ kind: 'ending', session: session({ end_reason: 'provider_closed' }), held: 60, refunded: 120 })
    expect(host.textContent).toContain('deal.ending.byThem')
    act(() => root.render(<ThreadDeal deal={{ kind: 'ending', session: session({ end_reason: 'buyer_closed' }), held: 60, refunded: 120 }} name="Sara" onChanged={() => {}} />))
    expect(host.textContent).toContain('deal.ending.byMe')
  })

  it('gives the offerer exactly three ways to say thank you', async () => {
    render({ kind: 'thank', session: session({ my_role: 'provider', transaction_status: 'succeeded' }) })
    expect(host.querySelectorAll('.cos-deal-thanks')).toHaveLength(3)
    await act(async () => { (host.querySelector('.cos-deal-thanks') as HTMLElement).click() })
    expect(api.sendThanks).toHaveBeenCalledWith(9, 'heart')
  })

  it('keeps a thank-you as the gesture alone, named only for screen readers', () => {
    act(() => root.render(<Keepsake reaction="pray" label="Sara thanked you" />))
    const keepsake = host.querySelector('.cos-deal-keepsake')!
    expect(keepsake.getAttribute('aria-label')).toBe('Sara thanked you')
    expect(keepsake.textContent).toBe('')
  })

  it('offers stopping after this block, and lets only whoever asked take it back', async () => {
    render({ kind: 'session', session: session({ status: 'open' }) })
    await press('deal.session.stopAfter')
    expect(api.stopAtBlockEnd).toHaveBeenCalledWith(9)

    act(() => root.render(<ThreadDeal deal={{ kind: 'session', session: session({ status: 'open', close_at_block_end_by_user_id: 3, i_asked_to_stop: false, can_stop_at_block_end: false }) }} name="Sara" onChanged={() => {}} />))
    expect(button('deal.session.cancelStop')).toBeUndefined()
    expect(host.textContent).toContain('deal.session.theyStop')
  })

  it('lets the offerer answer a request for one more block', async () => {
    render({ kind: 'session', session: session({ status: 'open', my_role: 'provider', extension_pending: true, can_stop_at_block_end: false }) })
    await press('deal.session.acceptMore')
    expect(api.acceptOneMoreBlock).toHaveBeenCalledWith(9)
  })

  it('says out loud when something fails', async () => {
    api.payRequest.mockRejectedValueOnce(new Error('not enough Photons'))
    render({ kind: 'request', stage: 'accepted', request: request({ direction: 'sent', status: 'accepted' }) })
    await press('deal.request.pay')
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('not enough Photons')
  })
})
