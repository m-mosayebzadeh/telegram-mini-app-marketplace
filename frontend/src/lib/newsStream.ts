/**
 * Where everything in the news region stands, as numbers.
 *
 * The approved regions prototype (docs/prototypes/regions.html, its
 * `geo()` and `layoutNews()`) lays the region out by arithmetic rather than
 * by flow: a wormhole near the top, a line of light running down from it
 * to a black hole, and cards hanging from that line at fixed steps. The
 * same arithmetic lives here, once, so the component only has to draw and
 * the rules can be tested on their own (newsStream.test.ts).
 *
 * The prototype is right-to-left only. In a left-to-right language the
 * whole region is mirrored — the line runs down the left, where the faces
 * are — so the card still hangs from the side its face is on.
 */

/** A card's height and the gap between two cards. */
export const ITEM_H = 64
export const GAP = 12
/** How long an answer takes to settle — the time it can still be taken back. */
export const SETTLE_MS = 4200
/** How long a taken-back answer takes to run backwards to where it was. */
export const UNDO_MS = 420
/** A sideways movement past this throws the card into the black hole. */
export const THROW_PX = 88
/** Smaller movements than this are still a tap. */
export const SLOP = 9
/** A card turned over and left alone turns back after this long. */
export const FLIP_BACK_MS = 6000
/** Throwing a card away: how long its fall takes, and when the hole swallows. */
export const DROP_MS = 820
export const GULP_AT_MS = 520
/** A refused card lingers this long, burnt, before it is gone. */
export const ASH_MS = 300
/** The flight of an accepted person down to Sol. */
export const FLIGHT_MS = 950

/** The prototype's header band: where the region's own space begins. */
const TOP = 70

export interface StreamBox {
  width: number
  height: number
  /** The phone's own safe areas (notch, home bar), in pixels. */
  safeTop: number
  safeBottom: number
  rtl: boolean
}

export interface StreamGeometry {
  /** Where the line of light runs, across the screen. */
  spineX: number
  /** The wormhole, where news comes from. */
  srcY: number
  /** Where the first card hangs, and where the stream stops showing things. */
  top: number
  bottom: number
  /** The black hole, where what you throw away goes. */
  sinkY: number
  /** Every card is the same width and starts at the same place. */
  cardLeft: number
  cardWidth: number
  rtl: boolean
}

export function streamGeometry(box: StreamBox): StreamGeometry {
  const top = TOP + box.safeTop
  const floor = box.height - box.safeBottom
  return {
    spineX: box.rtl ? box.width - 60 : 60,
    srcY: top + 52,
    top: top + 104,
    bottom: floor - 232,
    sinkY: floor - 196,
    // A card ends exactly where its connector reaches the line: 16 px from
    // the far edge, and 44 px short of the line on the near side.
    cardLeft: box.rtl ? 16 : 76,
    cardWidth: box.width - 92,
    rtl: box.rtl,
  }
}

/** Where the k-th card hangs, with the stream scrolled by `scroll`. */
export function slotY(g: StreamGeometry, k: number, scroll: number): number {
  return g.top + k * (ITEM_H + GAP) - scroll
}

/** How far the stream can be scrolled with `count` cards on it. */
export function maxScroll(g: StreamGeometry, count: number): number {
  return Math.max(0, count * (ITEM_H + GAP) + 40 - (g.bottom - g.top))
}

export function clampScroll(g: StreamGeometry, count: number, scroll: number): number {
  return Math.max(0, Math.min(maxScroll(g, count), scroll))
}

/**
 * How visible a card is at height `y`. Things near the ends of the stream
 * fade rather than being cut, and a card that is mostly faded can no
 * longer be touched (the caller uses `touchable`).
 */
export function edgeFade(g: StreamGeometry, y: number): number {
  return Math.max(0, Math.min(1, (y - g.top + 70) / 70, (g.bottom + 30 - y) / 70))
}
export const touchable = (fade: number): boolean => fade > 0.4

/** The sideways shift that puts a card's middle on the line of light. */
export function toSpine(g: StreamGeometry): number {
  return g.spineX - g.cardLeft - g.cardWidth / 2
}

/** A card shrunk to a speck and spun, at one of the two holes. */
export function inHole(g: StreamGeometry, holeY: number, turn: number, scale: number): string {
  return `translate3d(${toSpine(g)}px, ${holeY - ITEM_H / 2}px, 0) scale(${scale}) rotate(${turn}deg)`
}
/** Just out of the wormhole: where a new card starts. */
export const emerging = (g: StreamGeometry): string => inHole(g, g.srcY, -260, 0.05)
/** In the black hole: where a thrown card ends. */
export const swallowed = (g: StreamGeometry): string => inHole(g, g.sinkY, 480, 0.04)

/** Where the "that's everything" line sits: under the last card, or near
 *  the top when there is nothing at all. */
export function endY(g: StreamGeometry, count: number, scroll: number): number {
  return count ? slotY(g, count, scroll) + 8 : g.top + 40
}

/**
 * The curve an accepted person flies along to Sol: out sideways past the
 * cards and down, a quadratic curve through a point to one side of both
 * ends. `u` runs from 0 (the card) to 1 (Sol).
 */
export function flightPoint(
  from: { x: number; y: number },
  to: { x: number; y: number },
  u: number,
  rtl: boolean,
): { x: number; y: number } {
  const bend = {
    x: rtl ? Math.min(from.x, to.x) - 70 : Math.max(from.x, to.x) + 70,
    y: from.y + (to.y - from.y) * 0.35,
  }
  const a = (1 - u) ** 2
  const b = 2 * (1 - u) * u
  const c = u * u
  return { x: a * from.x + b * bend.x + c * to.x, y: a * from.y + b * bend.y + c * to.y }
}
