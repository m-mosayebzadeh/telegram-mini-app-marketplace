import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../lib/api'
import { TeamAction } from './TeamAction'

const mocks = vi.hoisted(() => ({ closeSession: vi.fn() }))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('../../lib/sessionsApi', () => ({ closeSession: mocks.closeSession }))

/** "A new sign-in to your account — close this session", right in the message (section 37). */
describe('the button under a Cosmos Team message', () => {
  let host: HTMLDivElement
  let root: Root
  beforeEach(() => {
    mocks.closeSession.mockReset()
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
  })
  afterEach(() => {
    act(() => root.unmount())
    host.remove()
  })

  it('closes that session and says so', async () => {
    mocks.closeSession.mockResolvedValue(undefined)
    await act(async () => root.render(<TeamAction action="close_session:42" />))
    await act(async () => host.querySelector('button')!.click())
    expect(mocks.closeSession).toHaveBeenCalledWith(42)
    expect(host.textContent).toContain('team.closed')
  })

  it('a session closed meanwhile says it is no longer open, not an error', async () => {
    mocks.closeSession.mockRejectedValue(new ApiError(404, null))
    await act(async () => root.render(<TeamAction action="close_session:42" />))
    await act(async () => host.querySelector('button')!.click())
    expect(host.textContent).toContain('team.notOpen')
  })

  it('an old note about a closed session offers no button', async () => {
    await act(async () => root.render(<TeamAction action="close_session:42" open={false} />))
    expect(host.querySelector('button')).toBeNull()
    expect(host.textContent).toContain('team.notOpen')
  })

  it('a note about this very device does not offer to sign it out', async () => {
    await act(async () => root.render(<TeamAction action="close_session:42" open hereSession={42} />))
    expect(host.querySelector('button')).toBeNull()
    expect(host.textContent).toContain('team.thisDevice')
  })

  it('offers to try again when it did not go through', async () => {
    mocks.closeSession.mockRejectedValue(new Error('network'))
    await act(async () => root.render(<TeamAction action="close_session:42" />))
    await act(async () => host.querySelector('button')!.click())
    expect(host.textContent).toContain('team.tryAgain')
  })

  it('shows nothing for an action it does not know', async () => {
    await act(async () => root.render(<TeamAction action="something_else:1" />))
    expect(host.innerHTML).toBe('')
  })
})
