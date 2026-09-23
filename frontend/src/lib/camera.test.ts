import { describe, it, expect } from 'vitest'
import {
  DETAIL_MAX,
  DETAIL_MIN_ZOOM,
  NOBODY,
  detailAround,
  detailRadii,
  hasArrived,
  hitTest,
  layerShift,
  sameIds,
  screenOf,
  stepCamera,
  type Body,
  type Camera,
  type View,
} from './camera'

const VIEW: View = { width: 390, height: 844, floor: 190 }
const STILL: Camera = { x: 0, y: 0, z: 1 }

function body(id: number, x: number, y: number, layer = 1): Body {
  return { user_id: id, x, y, layer }
}

describe('where a body is on the screen', () => {
  it('puts a body at the origin in the middle of the space Sol leaves', () => {
    // Not the middle of the glass: the bottom belongs to Sol, and centring
    // on the glass hid the densest part of the world behind it.
    const at = screenOf(body(1, 0, 0), STILL, VIEW)
    expect(at.x).toBe(195)
    expect(at.y).toBe((844 - 190) / 2)
  })

  it('moves a body exactly as far as the camera travelled, in the middle layer', () => {
    const at = screenOf(body(1, 0, 0), { x: 100, y: 0, z: 1 }, VIEW)
    expect(at.x).toBe(95)
  })

  it('sweeps the near layer further past you than the far one', () => {
    // This is the whole illusion of depth, and it was inverted: the near
    // layer was the slowest of the three.
    const cam: Camera = { x: 100, y: 0, z: 1 }
    const near = screenOf(body(1, 0, 0, 0), cam, VIEW).x
    const middle = screenOf(body(2, 0, 0, 1), cam, VIEW).x
    const far = screenOf(body(3, 0, 0, 2), cam, VIEW).x
    expect(near).toBeLessThan(middle)
    expect(middle).toBeLessThan(far)
  })

  it('agrees with the shift each depth layer is given', () => {
    // The projection and the transform actually written to the DOM are
    // two descriptions of one thing. When they disagreed, taps landed on
    // whoever used to be there.
    const cam: Camera = { x: 140, y: -60, z: 1 }
    for (const layer of [0, 1, 2]) {
      const shift = layerShift(layer, cam)
      const drawn = { x: 40 + shift.x - cam.x, y: 25 + shift.y - cam.y }
      const at = screenOf(body(1, 40, 25, layer), cam, VIEW)
      expect(at.x).toBeCloseTo(195 + drawn.x, 6)
      expect(at.y).toBeCloseTo(327 + drawn.y, 6)
    }
  })

  it('scales with the zoom', () => {
    const wide = screenOf(body(1, 200, 0), { x: 0, y: 0, z: 0.5 }, VIEW)
    expect(wide.x).toBe(195 + 100)
  })
})

describe('tapping', () => {
  const crowd = [body(1, 0, 0), body(2, 300, 0), body(3, -300, 0)]

  it('finds the body under the finger', () => {
    const at = screenOf(crowd[1], STILL, VIEW)
    expect(hitTest(crowd, STILL, VIEW, at, 46)?.user_id).toBe(2)
  })

  it('finds nobody in empty space', () => {
    expect(hitTest(crowd, STILL, VIEW, { x: 195, y: 120 }, 46)).toBeNull()
  })

  it('still finds the right body when the camera has moved and zoomed', () => {
    const cam: Camera = { x: 180, y: -90, z: 0.6 }
    const at = screenOf(crowd[2], cam, VIEW)
    expect(hitTest(crowd, cam, VIEW, at, 46)?.user_id).toBe(3)
  })

  it('narrows the catch radius as the world is pulled out', () => {
    // Otherwise one finger out at arm's length covers six people.
    const cam: Camera = { x: 0, y: 0, z: 0.4 }
    const at = screenOf(crowd[0], cam, VIEW)
    expect(hitTest(crowd, cam, VIEW, { x: at.x + 30, y: at.y }, 46)).toBeNull()
    expect(hitTest(crowd, STILL, VIEW, { x: at.x + 30, y: at.y }, 46)?.user_id).toBe(1)
  })
})

describe('who gets a name and a face', () => {
  it('measures nearness against the screen rather than a fixed number', () => {
    // Tuned in pixels on one screen it named three people on another,
    // which is a sky with no names in it.
    const wide = detailRadii({ width: 900, height: 844, floor: 190 })
    const narrow = detailRadii({ width: 360, height: 844, floor: 190 })
    expect(wide.near).toBeGreaterThan(narrow.near)
    expect(wide.far).toBeGreaterThan(wide.near)
  })

  it('names the ones near the middle of the screen and nobody else', () => {
    const crowd = [body(1, 0, 0), body(2, 40, 30), body(3, 900, 0)]
    const near = detailAround(crowd, STILL, VIEW, NOBODY)
    expect(near.has(1)).toBe(true)
    expect(near.has(2)).toBe(true)
    expect(near.has(3)).toBe(false)
  })

  it('follows the camera, which is the entire point', () => {
    // The version before this fixed the set at "the ten nearest in the
    // list", so travelling across the world changed nothing: detail lived
    // in one place and stayed there.
    const far = body(9, 900, 0)
    expect(detailAround([far], STILL, VIEW, NOBODY).has(9)).toBe(false)
    expect(detailAround([far], { x: 900, y: 0, z: 1 }, VIEW, NOBODY).has(9)).toBe(true)
  })

  it('keeps somebody on the boundary rather than flickering them', () => {
    const edge = body(5, detailRadii(VIEW).near + 20, 0)
    expect(detailAround([edge], STILL, VIEW, NOBODY).has(5)).toBe(false)
    expect(detailAround([edge], STILL, VIEW, new Set([5])).has(5)).toBe(true)
  })

  it('lets go once somebody is properly gone', () => {
    const away = body(5, detailRadii(VIEW).far + 100, 0)
    expect(detailAround([away], STILL, VIEW, new Set([5])).has(5)).toBe(false)
  })

  it('names nobody when the world is pulled right out', () => {
    // At that size a name is a smudge, and thirty of them are a fog.
    const cam: Camera = { x: 0, y: 0, z: DETAIL_MIN_ZOOM - 0.01 }
    expect(detailAround([body(1, 0, 0)], cam, VIEW, NOBODY).size).toBe(0)
  })

  it('caps how many faces can be asked for at once', () => {
    const crowd = Array.from({ length: 40 }, (_, index) => body(index, index * 4, 0))
    expect(detailAround(crowd, STILL, VIEW, NOBODY).size).toBe(DETAIL_MAX)
  })

  it('keeps the nearest when it has to choose', () => {
    const crowd = Array.from({ length: 40 }, (_, index) => body(index, index * 4, 0))
    const near = detailAround(crowd, STILL, VIEW, NOBODY)
    expect(near.has(0)).toBe(true)
    expect(near.has(39)).toBe(false)
  })

  it('survives a camera whose zoom has gone bad instead of naming everybody', () => {
    const broken = { x: 0, y: 0, z: Number.NaN }
    expect(detailAround([body(1, 0, 0)], broken, VIEW, NOBODY).size).toBe(0)
  })
})

describe('the same people, or different ones', () => {
  it('sees no change in an equal set', () => {
    expect(sameIds(new Set([1, 2, 3]), new Set([3, 2, 1]))).toBe(true)
  })

  it('sees a change when somebody arrives or leaves', () => {
    expect(sameIds(new Set([1, 2]), new Set([1, 2, 3]))).toBe(false)
    expect(sameIds(new Set([1, 2]), new Set([1, 4]))).toBe(false)
  })
})

describe('the camera moving', () => {
  it('closes on its target without overshooting', () => {
    let cam: Camera = { x: 0, y: 0, z: 1 }
    const target: Camera = { x: 300, y: -200, z: 0.5 }
    for (let frame = 0; frame < 400; frame += 1) cam = stepCamera(cam, target, 0.14)
    expect(hasArrived(cam, target)).toBe(true)
  })

  it('never produces a number the browser cannot read', () => {
    // This is the freeze, written as a test. A target that lost its zoom
    // made every later frame NaN: the scene's scale became unreadable, the
    // world stopped moving, and no tap could hit anything because every
    // comparison against NaN is false.
    let cam: Camera = { x: 0, y: 0, z: 1 }
    const target: Camera = { x: 120, y: 44, z: 1 }
    for (let frame = 0; frame < 60; frame += 1) {
      cam = stepCamera(cam, target, 0.14)
      expect(Number.isFinite(cam.x)).toBe(true)
      expect(Number.isFinite(cam.y)).toBe(true)
      expect(Number.isFinite(cam.z)).toBe(true)
    }
  })

  it('has not arrived while it is still travelling', () => {
    expect(hasArrived({ x: 0, y: 0, z: 1 }, { x: 300, y: 0, z: 1 })).toBe(false)
    expect(hasArrived({ x: 0, y: 0, z: 1 }, { x: 0, y: 0, z: 0.42 })).toBe(false)
  })
})
