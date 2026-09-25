import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Orb } from './Orb'

/**
 * Moons: "this person has something to show" (TECHNICAL_REQUIREMENTS.md
 * 29.14). Up to three, and only when you are near — from a distance they
 * are specks nobody can read and animations nobody sees.
 */
describe('moons', () => {
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

  function draw(props: { moons: number; near: boolean }) {
    act(() => root.render(<Orb presence={0.5} trust={0.5} seed={7} {...props} />))
    return host.querySelectorAll('.cos-moon').length
  }

  it('draws none from a distance', () => {
    expect(draw({ moons: 3, near: false })).toBe(0)
  })

  it('draws one per thing to show when near', () => {
    expect(draw({ moons: 2, near: true })).toBe(2)
  })

  it('never draws more than three', () => {
    expect(draw({ moons: 9, near: true })).toBe(3)
  })

  it('draws none for somebody with nothing to show', () => {
    expect(draw({ moons: 0, near: true })).toBe(0)
  })
})
