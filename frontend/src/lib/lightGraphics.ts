/**
 * "Light graphics" (section 32, step 4): the one switch that turns off what
 * costs a cheap phone the most — the blur that shows distance and the
 * drifting dust — so every phone gets the best it can actually sustain.
 *
 * Per device, not per account: it is about this phone. Kept in the
 * browser's storage, and stamped on <html> as a class the stylesheet reads
 * (styles/cosmos.css, "light graphics"). Motion that carries meaning, like
 * the Echo mark's states, stays; that is reduced motion's job, not this.
 */

const KEY = 'cos-light-graphics'
const CLASS = 'cos-lite'

export function readLightGraphics(): boolean {
  try {
    return localStorage.getItem(KEY) === '1'
  } catch {
    return false
  }
}

/** Applies the stored choice; called once as the app starts. */
export function applyLightGraphics(on: boolean = readLightGraphics()): void {
  document.documentElement.classList.toggle(CLASS, on)
}

export function setLightGraphics(on: boolean): void {
  try {
    localStorage.setItem(KEY, on ? '1' : '0')
  } catch {
    // Storage blocked: it still applies for this visit.
  }
  applyLightGraphics(on)
}
