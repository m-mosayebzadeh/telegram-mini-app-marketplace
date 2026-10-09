import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'
import { useWide } from './useWide'

/** A computer's layout (section 43) follows the window as it is resized. */
describe('useWide', () => {
  it('follows the screen width as it changes', () => {
    let matches = false
    const listeners: (() => void)[] = []
    vi.stubGlobal('matchMedia', () => ({
      get matches() {
        return matches
      },
      addEventListener: (_: string, fn: () => void) => listeners.push(fn),
      removeEventListener: vi.fn(),
    }))
    const seen: boolean[] = []
    function Probe() {
      seen.push(useWide())
      return null
    }
    const root = createRoot(document.createElement('div'))
    act(() => root.render(<Probe />))
    matches = true
    act(() => listeners.forEach((fn) => fn()))
    expect(seen[0]).toBe(false)
    expect(seen[seen.length - 1]).toBe(true)
    act(() => root.unmount())
    vi.unstubAllGlobals()
  })
})
