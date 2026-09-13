import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest'
import { VoicePlayer } from './VoicePlayer'

const mocks = vi.hoisted(() => ({
  t: (key: string, args?: Record<string, unknown>) =>
    args ? `${key} ${JSON.stringify(args)}` : key,
}))
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: mocks.t, i18n: { language: 'en' } }),
}))

let root: Root
let container: HTMLDivElement

async function render(src: string | null, durationSeconds: number | null = 8) {
  await act(async () => {
    root.render(<VoicePlayer src={src} durationSeconds={durationSeconds} />)
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

describe('VoicePlayer', () => {
  it('offers playback when there is audio to play', async () => {
    await render('blob:recording')

    expect(container.querySelector('audio')?.getAttribute('src')).toBe('blob:recording')
    expect(container.querySelector('.cm-voice-play')).toBeTruthy()
  })

  it('offers no play control for a message with no audio', async () => {
    // Voice messages recorded before real audio existed stored only a
    // length. A play button on one of those is a control that cannot
    // work, which is worse than no control.
    await render(null)

    expect(container.querySelector('.cm-voice-play')).toBeNull()
    expect(container.querySelector('audio')).toBeNull()
    // The length is still shown: the message did happen.
    expect(container.textContent).toContain('"seconds":8')
  })

  it('shows the full length at rest', async () => {
    await render('blob:recording', 12)

    expect(container.querySelector('.cm-voice-time')?.textContent).toContain('"seconds":12')
  })

  it('counts up and fills as it plays', async () => {
    await render('blob:recording', 10)
    const audio = container.querySelector('audio')!

    await act(async () => {
      audio.dispatchEvent(new Event('play'))
      Object.defineProperty(audio, 'currentTime', { value: 5, configurable: true })
      audio.dispatchEvent(new Event('timeupdate'))
    })

    expect(container.querySelector('.cm-voice-time')?.textContent).toContain('"seconds":5')
    expect(container.querySelector<HTMLElement>('.cm-voice-fill')!.style.inlineSize).toBe('50%')
  })

  it('returns to the start when it finishes', async () => {
    await render('blob:recording', 10)
    const audio = container.querySelector('audio')!

    await act(async () => {
      audio.dispatchEvent(new Event('play'))
      Object.defineProperty(audio, 'currentTime', { value: 10, configurable: true })
      audio.dispatchEvent(new Event('timeupdate'))
      audio.dispatchEvent(new Event('ended'))
    })

    // Back to the full length, ready to play again.
    expect(container.querySelector('.cm-voice-time')?.textContent).toContain('"seconds":10')
    expect(container.querySelector<HTMLElement>('.cm-voice-fill')!.style.inlineSize).toBe('0%')
  })
})
