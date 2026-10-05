import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AdultGate } from './AccountDoors'

const mocks = vi.hoisted(() => ({ confirmAdult: vi.fn() }))
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
}))
vi.mock('../../lib/accountApi', () => ({ confirmAdult: mocks.confirmAdult }))

/** "Eighteen or over", the first time Echo opens (section 32). */
describe('the eighteen-or-over gate', () => {
  let host: HTMLDivElement
  let root: Root
  beforeEach(() => {
    mocks.confirmAdult.mockReset().mockResolvedValue(undefined)
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
  })
  afterEach(() => {
    act(() => root.unmount())
    host.remove()
  })
  const button = (label: string) =>
    [...host.querySelectorAll('button')].find((b) => (b.textContent ?? '').includes(label)) as HTMLButtonElement | undefined

  it('lets you in once you say so', async () => {
    const done = vi.fn()
    await act(async () => root.render(<AdultGate onDone={done} onNo={vi.fn()} />))
    await act(async () => button('adult.yes')!.click())
    expect(mocks.confirmAdult).toHaveBeenCalled()
    expect(done).toHaveBeenCalled()
  })

  it('sends "under eighteen" back to the world, saving nothing', async () => {
    const no = vi.fn()
    await act(async () => root.render(<AdultGate onDone={vi.fn()} onNo={no} />))
    await act(async () => button('adult.no')!.click())
    expect(no).toHaveBeenCalled()
    expect(mocks.confirmAdult).not.toHaveBeenCalled()
  })
})
