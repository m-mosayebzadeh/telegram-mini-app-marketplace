import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ChatMenu } from './ChatMenu'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
}))

/** The menu behind the three dots at the top of a chat (section 32). */
describe('the chat menu', () => {
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

  const labels = () => [...host.querySelectorAll('[role="menuitem"]')].map((b) => b.textContent)

  it('offers the four things, in Telegram order', () => {
    act(() => root.render(<ChatMenu muted={false} onChoose={() => {}} onClose={() => {}} />))
    expect(labels()).toEqual(['talk.menu.mute', 'talk.menu.search', 'talk.menu.clear', 'talk.menu.delete'])
  })

  it('says "unmute" once the chat is muted', () => {
    act(() => root.render(<ChatMenu muted onChoose={() => {}} onClose={() => {}} />))
    expect(labels()[0]).toBe('talk.menu.unmute')
  })

  it('tells what was chosen', () => {
    const onChoose = vi.fn()
    act(() => root.render(<ChatMenu muted={false} onChoose={onChoose} onClose={() => {}} />))
    act(() => (host.querySelectorAll('[role="menuitem"]')[3] as HTMLButtonElement).click())
    expect(onChoose).toHaveBeenCalledWith('delete')
  })

  it('closes on a tap outside it', () => {
    const onClose = vi.fn()
    act(() => root.render(<ChatMenu muted={false} onChoose={() => {}} onClose={onClose} />))
    act(() => (host.querySelector('.cos-chatmenu-scrim') as HTMLElement).click())
    expect(onClose).toHaveBeenCalled()
  })
})
