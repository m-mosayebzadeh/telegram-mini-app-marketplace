import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest'
import { PersonSheet } from './PersonSheet'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
}))

/**
 * Somebody tapped in the world (TECHNICAL_REQUIREMENTS.md section 32): who
 * they are, and the two things to do, from the bottom of the screen.
 */
describe('the card of somebody tapped', () => {
  let host: HTMLDivElement
  let root: Root
  beforeEach(() => {
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
  })
  afterEach(() => {
    act(() => root.unmount())
    host.remove()
  })

  function render(over: Partial<Parameters<typeof PersonSheet>[0]> = {}) {
    const calls = { say: 0, profile: 0, close: 0 }
    act(() =>
      root.render(
        <PersonSheet
          name="Negar"
          face={<span>N</span>}
          online
          line="Up at night, never interrupting."
          sayLabel="sky.sayHello"
          onSay={() => { calls.say += 1 }}
          onProfile={() => { calls.profile += 1 }}
          onClose={() => { calls.close += 1 }}
          {...over}
        />,
      ),
    )
    return calls
  }

  it('says who they are and whether they are here now', () => {
    render()
    expect(host.querySelector('.cos-person-name')?.textContent).toBe('Negar')
    expect(host.querySelector('.cos-person-line')?.textContent).toContain('Up at night')
    expect(host.querySelector('.cos-person-flag.is-live')?.textContent).toBe('sky.hereNow')
  })

  it('leaves out what it does not know', () => {
    render({ online: false, line: null })
    expect(host.querySelector('.cos-person-flag.is-live')).toBeNull()
    expect(host.querySelector('.cos-person-line')).toBeNull()
  })

  it('says hello, opens the profile, and lets go on a tap outside', () => {
    const calls = render()
    act(() => (host.querySelector('.cos-person-say') as HTMLElement).click())
    act(() => (host.querySelector('.cos-person-see') as HTMLElement).click())
    act(() => (host.querySelector('.cos-person-veil') as HTMLElement).click())
    expect(calls).toEqual({ say: 1, profile: 1, close: 1 })
  })

  it('shows what matters right now, and why hello is not possible today', () => {
    render({ flags: ['sky.hasNewsForYou'], limit: 'sky.dailyLimit' })
    expect(host.textContent).toContain('sky.hasNewsForYou')
    expect(host.querySelector('.cos-person-limit')?.textContent).toBe('sky.dailyLimit')
  })

  it('answers their note with one tap, and says when it was written', () => {
    let answered = 0
    render({ lineAt: new Date().toISOString(), onReplyNote: () => { answered += 1 } })
    act(() => (host.querySelector('button.cos-person-line') as HTMLElement).click())
    expect(answered).toBe(1)
    expect(host.querySelector('.cos-person-when')?.textContent).toBe('note.writtenAt')
  })
})
