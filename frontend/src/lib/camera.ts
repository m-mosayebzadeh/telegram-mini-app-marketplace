/**
 * Where the camera is, and what that means for what you can see.
 *
 * This lives apart from the screen that uses it for one reason: it is the
 * only part of the world that is pure arithmetic, and the whole world is
 * wrong when the arithmetic is. Two bugs came out of having it inline —
 * a projection that drifted out of step with the one the browser was
 * actually applying, so taps landed on whoever used to be there, and a
 * zoom that was quietly dropped on the way into a target, which turned
 * every later frame into a value the browser could not read and froze the
 * screen until it was left and come back to.
 *
 * Neither could be tested where it was. Here they can.
 */

export interface Camera {
  x: number
  y: number
  /** Zoom. Never optional anywhere, ever: this is the field whose absence
   *  froze the world. */
  z: number
}

/** The part of a body this file needs, which is deliberately not a whole
 *  person — the projection has no business knowing anybody's name. */
export interface Body {
  user_id: number
  x: number
  y: number
  layer: number
}

/**
 * The screen the world is drawn on.
 *
 * `floor` is how much of the bottom belongs to Sol. The world is centred
 * on the middle of what is LEFT, not the middle of the glass, or the
 * densest and best part of it sits behind the one control there is.
 */
export interface View {
  width: number
  height: number
  floor: number
}

/** How much each layer moves relative to the camera. Greater than one for
 *  the near layer: things close to you sweep PAST you when you move, which
 *  is the whole illusion. Mirrors LAYER_DEPTH in phyllotaxis.ts, which
 *  owns where bodies are placed. */
export const LAYER_DEPTH = [1.09, 1.0, 0.93] as const

/**
 * How near "near" is, as a share of the view's shorter side.
 *
 * A share rather than a number of pixels, because the answer wanted is
 * "roughly the people you can see" and that is a different number of
 * pixels on a phone than on a tablet. A fixed radius tuned on one screen
 * named three people on the other, which is a sky with no names in it.
 *
 * Two radii rather than one: a body that gained its name at exactly the
 * distance it loses one would flicker forever for anybody holding still
 * on the boundary.
 */
export const DETAIL_IN_SHARE = 0.85
export const DETAIL_OUT_SHARE = 1.12

/** Those shares, in pixels, for a given screen. */
export function detailRadii(view: View): { near: number; far: number } {
  const shorter = Math.min(view.width, view.height - view.floor)
  return { near: shorter * DETAIL_IN_SHARE, far: shorter * DETAIL_OUT_SHARE }
}

/** Pulled out past this, nobody is named. At that size a name is a smudge,
 *  and thirty smudges are a fog over the whole sky. */
export const DETAIL_MIN_ZOOM = 0.7

/** However dense the crowd gets, this many faces at once and no more — a
 *  ceiling on what the sky can ever ask the network for in one moment. */
export const DETAIL_MAX = 12

/** One shared empty set, so "nobody is near" is always the same object and
 *  can never be mistaken for a change. */
export const NOBODY: ReadonlySet<number> = new Set()

/** The point the world is centred on. */
export function anchorOf(view: View): { x: number; y: number } {
  return { x: view.width / 2, y: (view.height - view.floor) / 2 }
}

/**
 * How far a depth layer is shifted, given where the camera is.
 *
 * The scene subtracts the camera once for everybody; a layer supplies the
 * REMAINDER of its own depth. The sign of this was wrong and made the
 * near layer the slowest of the three — depth, inside out.
 */
export function layerShift(layer: number, cam: Camera): { x: number; y: number } {
  const extra = 1 - LAYER_DEPTH[layer]
  return { x: cam.x * extra, y: cam.y * extra }
}

/**
 * Where a body actually is on the screen.
 *
 * Parallax applies to the CAMERA's travel, not to a body's position: a
 * nearer layer sweeps further past you as you move, and sits perfectly
 * still when you do not. Everything that needs this answer — drawing,
 * tapping, deciding who is near — asks here, because two copies of a
 * projection drift apart the first time either one is touched.
 */
export function screenOf(body: Body, cam: Camera, view: View): { x: number; y: number } {
  const depth = LAYER_DEPTH[body.layer]
  const anchor = anchorOf(view)
  return {
    x: anchor.x + (body.x - cam.x * depth) * cam.z,
    y: anchor.y + (body.y - cam.y * depth) * cam.z,
  }
}

/** Who, if anybody, is under this point on the screen. */
export function hitTest(
  bodies: readonly Body[],
  cam: Camera,
  view: View,
  point: { x: number; y: number },
  radius: number,
): Body | null {
  let best: Body | null = null
  // The catch radius follows the zoom, or one finger pulled out covers
  // six people.
  let bestDistance = radius * cam.z
  for (const body of bodies) {
    const at = screenOf(body, cam, view)
    const away = Math.hypot(point.x - at.x, point.y - at.y)
    if (away < bestDistance) {
      bestDistance = away
      best = body
    }
  }
  return best
}

/**
 * Who is close enough to be a person rather than a shape.
 *
 * `had` is who carried detail a moment ago, and they are held to the wider
 * radius — that is the hysteresis, and without it a body resting on the
 * boundary flickers its name on and off forever.
 */
export function detailAround(
  bodies: readonly Body[],
  cam: Camera,
  view: View,
  had: ReadonlySet<number>,
): ReadonlySet<number> {
  if (!(cam.z >= DETAIL_MIN_ZOOM)) return NOBODY
  const anchor = anchorOf(view)
  const radii = detailRadii(view)
  const close: Array<{ id: number; away: number }> = []
  for (const body of bodies) {
    const at = screenOf(body, cam, view)
    const away = Math.hypot(at.x - anchor.x, at.y - anchor.y)
    if (away < (had.has(body.user_id) ? radii.far : radii.near)) {
      close.push({ id: body.user_id, away })
    }
  }
  close.sort((a, b) => a.away - b.away)
  return new Set(close.slice(0, DETAIL_MAX).map((one) => one.id))
}

/** Whether two sets hold the same people. Cheaper than a re-render, which
 *  is the whole reason it exists. */
export function sameIds(a: ReadonlySet<number>, b: ReadonlySet<number>): boolean {
  if (a === b) return true
  if (a.size !== b.size) return false
  for (const id of a) if (!b.has(id)) return false
  return true
}

/**
 * One frame of the camera moving towards where it is going.
 *
 * Returns a whole camera rather than editing one, so a caller cannot half
 * apply it. Every field is required on both sides, which is the thing that
 * makes the freeze impossible to write again: there is no shape of target
 * that has an x and a y and no zoom.
 */
export function stepCamera(cam: Camera, target: Camera, ease: number): Camera {
  return {
    x: cam.x + (target.x - cam.x) * ease,
    y: cam.y + (target.y - cam.y) * ease,
    z: cam.z + (target.z - cam.z) * ease,
  }
}

/** Whether the camera has effectively arrived. */
export function hasArrived(cam: Camera, target: Camera): boolean {
  return (
    Math.hypot(target.x - cam.x, target.y - cam.y) < 1.5 && Math.abs(target.z - cam.z) < 0.004
  )
}
