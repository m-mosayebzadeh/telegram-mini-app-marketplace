import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, it, expect } from 'vitest'
import { CosmosMark } from './CosmosMark'
import { TeamMark } from './TeamMark'

/** The mark the owner chose (section 43): two rings and the star between. */
describe('the Cosmos mark', () => {
  function draw(node: React.ReactNode) {
    const host = document.createElement('div')
    const root = createRoot(host)
    act(() => root.render(node))
    return { host, done: () => act(() => root.unmount()) }
  }

  it('is two rings, warm and cool, and a star', () => {
    const { host, done } = draw(<CosmosMark />)
    expect(host.querySelectorAll('circle')).toHaveLength(2)
    expect(host.querySelector('.cos-mark-warm')?.getAttribute('stroke')).toBe('#f2b06a')
    expect(host.querySelector('.cos-mark-cool')?.getAttribute('stroke')).toBe('#7ad7c8')
    expect(host.querySelector('.cos-mark-star')).not.toBeNull()
    done()
  })

  it('moves only when asked to', () => {
    const still = draw(<CosmosMark />)
    expect(still.host.querySelector('.is-arriving')).toBeNull()
    still.done()
    const moving = draw(<CosmosMark arrive />)
    expect(moving.host.querySelector('.is-arriving')).not.toBeNull()
    moving.done()
  })

  it("is Cosmos Team's face", () => {
    const { host, done } = draw(<TeamMark className="face" />)
    const face = host.querySelector('[role="img"]')!
    expect(face.getAttribute('aria-label')).toBe('Cosmos Team')
    expect(face.querySelector('.cos-mark')).not.toBeNull()
    done()
  })
})
