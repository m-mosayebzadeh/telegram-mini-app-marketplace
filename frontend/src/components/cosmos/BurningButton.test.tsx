import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BurningButton } from './Fuse'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, v?: { time?: string }) => `${key}:${v?.time ?? ''}`, i18n: { language: 'en' } }),
}))

/** The payment button as the fuse (section 30.20). */
describe('the burning payment button', () => {
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

  const inMinutes = (m: number) => new Date(Date.now() + m * 60_000).toISOString()

  it('holds as much warmth as there is time left', () => {
    act(() => root.render(
      <BurningButton deadline={inMinutes(7.5)} start={inMinutes(-7.5)} label="pay" timeLabel="left" />,
    ))
    const button = host.querySelector('.cos-burn-btn') as HTMLElement
    expect(Number(button.style.getPropertyValue('--cord'))).toBeCloseTo(0.5, 1)
    expect(host.querySelector('.cos-burn-time')?.textContent).toMatch(/^left:7:[23][0-9]$/)
  })

  it('cannot be pressed once the time is gone, and asks for the state again', () => {
    const onDone = vi.fn()
    const onClick = vi.fn()
    act(() => root.render(
      <BurningButton deadline={inMinutes(-1)} start={inMinutes(-16)} label="pay" timeLabel="left" onClick={onClick} onDone={onDone} />,
    ))
    const button = host.querySelector('button') as HTMLButtonElement
    expect(button.disabled).toBe(true)
    expect(onDone).toHaveBeenCalledTimes(1)
  })

  it('shows the other side the same burn with nothing to press', () => {
    act(() => root.render(
      <BurningButton passive deadline={inMinutes(5)} start={inMinutes(-10)} label="waiting" timeLabel="left" />,
    ))
    expect(host.querySelector('button')).toBeNull()
    expect(host.querySelector('.cos-burn-btn.is-passive')).not.toBeNull()
  })
})
