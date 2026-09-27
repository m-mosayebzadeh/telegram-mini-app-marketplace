import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Orb } from '../components/cosmos/Orb'
import { SpaceGround, DUST_LAYERS, seededRandom } from '../components/cosmos/SpaceGround'
import { Orbits } from '../components/cosmos/Orbits'
import { CoreNav } from '../components/cosmos/CoreNav'
import { SkyHeader } from '../components/cosmos/SkyHeader'
import { MiniEcho, MiniMe, MiniNews, MiniTalk } from '../components/cosmos/RegionMinis'
import { TalkStair } from '../components/cosmos/TalkStair'
import { NewsFeed } from '../components/cosmos/NewsFeed'
import { SessionClock } from '../components/cosmos/SessionClock'
import { lightTowardsCentre, place } from '../lib/phyllotaxis'
import {
  NOBODY,
  anchorOf,
  detailAround,
  hasArrived,
  hitTest as hitTestAt,
  isWide,
  worldAt,
  layerShift,
  sameIds,
  screenOf,
  stepCamera,
  type Camera,
  type View,
} from '../lib/camera'
import { fetchSky, type SkyPerson } from '../lib/skyApi'
import { formatApiError } from '../lib/api'
import { NEEDS_YOU } from '../lib/relations'
import type { NewsItem } from '../lib/news'
import { acceptFollow, confirmRequest, refuseFollow, refuseRequest, useWorld } from '../lib/worldApi'

/**
 * The world.
 *
 * Everything below follows two rules that cost more to write than the
 * obvious versions and are the reason this stays smooth on a cheap phone
 * (TECHNICAL_REQUIREMENTS.md section 23.4):
 *
 * 1. **Seven style writes per frame.** The scene, three depth layers and
 *    three dust layers. No orb's position is ever touched after it is
 *    placed — they breathe with a CSS animation the browser owns, and the
 *    camera moves the layers under them.
 *
 * 2. **Hit testing by hand.** The drag needs pointer capture, and pointer
 *    capture sends every click to the element that holds it — so an orb
 *    never receives one. Working out what was tapped is therefore our
 *    job, from the coordinates.
 *
 * Choosing somebody is ONE state, not two. It used to be a look followed
 * by a swipe up into a card of buttons, and the swipe was never found.
 * Holding a person now shows everything at once, which it can afford to
 * do because none of it is a panel covering the world: the name is on the
 * face, and the two things you can do stand in the light falling from it.
 * See "holding somebody" in cosmos.css for why.
 */

/** How fast a flick keeps travelling, and when it is considered stopped. */
const FRICTION = 0.935
const STILL = 0.02
/** A movement bigger than this is a drag, not a tap. In CSS pixels, and
 *  generous: fingers move a little on every tap. */
const DRAG_SLOP = 9

/**
 * Detail follows the camera, not the list.
 *
 * Who carries a name and a face is a question about where you are looking
 * right now, so it is measured from the middle of the screen and asked
 * again as the camera moves. Going towards somebody brings them into
 * focus; leaving lets them fade back to a shape. The earlier version fixed
 * the set at "the ten nearest in the list", which never changed however
 * far you travelled — the world had detail in exactly one place.
 *
 * The thresholds themselves live in lib/camera.ts, with the arithmetic
 * they belong to.
 */

/** How much of the bottom of the screen belongs to Sol and its system.
 *  Home has to sit in the middle of what is LEFT, or the densest and best
 *  part of the world ends up hidden behind the one control it has. */
const FLOOR = 190

/** How far out the camera pulls to show the whole sky at once — the
 *  furthest a pinch or the mouse wheel can take it. */
const WIDE_SCALE = 0.42

/**
 * The regions of the world (TECHNICAL_REQUIREMENTS.md sections 30.5–30.8).
 *
 * Conversations and news are not other pages: they happen IN the world —
 * the people you talk to are pulled out of it towards you, news arrives
 * out of a wormhole above it. Each still has an address of its own, so
 * the phone's back button leaves a region the way people expect, and a
 * link can open one directly.
 */
export type Region = 'world' | 'talk' | 'news'
export function regionOf(param: string | undefined): Region {
  return param === 'talk' || param === 'news' ? param : 'world'
}
/** How long the people on the stair take to fly back to their places: the
 *  prototype's 950 ms, plus 45 ms for each person, because they leave one
 *  after another. */
const FLY_HOME_MS = 950
const FLY_HOME_EACH_MS = 45
/** A journey between places, as in the prototype: the place you are in
 *  rushes past and blurs for this long, then the new one settles in. */
const JOURNEY_MS = 380

/** Two speeds. Dragging needs to feel attached to the finger; travelling
 *  home is a journey and reads better slow enough to watch. */
const CAMERA_EASE_DRAG = 0.14
const CAMERA_EASE_GLIDE = 0.045

/** How often the question is asked again. Sixty times a second would be
 *  sixty re-renders a second; nine is already faster than the eye. */
const DETAIL_EVERY_MS = 110

/** How far from an orb's centre still counts as hitting it. */
const HIT_RADIUS = 46

/** How far above the middle a held person is lifted, as a share of the
 *  screen. Enough to leave room for their name and their light beneath
 *  them; not so much that they end up at the top of the screen with
 *  everything about them at the bottom, which is what it used to do. */
const HOLD_LIFT = 0.1

interface Star extends SkyPerson {
  x: number
  y: number
  rank: number
  layer: number
  driftSeconds: number
  driftDelay: number
}

export default function Sky() {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const location = useLocation()
  const region = regionOf(useParams().region)
  const world = useWorld()
  /** The region on screen. Trails `region` by a moment when leaving the
   *  stair, so the people on it can fly home before it goes. */
  const [shown, setShown] = useState<Region>(region)
  const [leaving, setLeaving] = useState(false)
  /** Where a journey between places is: the old place rushing past, or the
   *  new one settling in. The stars stretch into streaks while it rushes. */
  const [journey, setJourney] = useState<'leave' | 'arrive' | null>(null)
  /** The first-time hint over Sol, until Sol is first touched. */
  const [hintSeen, setHintSeen] = useState(() => {
    try {
      return localStorage.getItem('cos-sol-hint-seen') === '1'
    } catch {
      return false
    }
  })
  /** Fingers on the glass, for the pinch. */
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const pinch = useRef<{ distance: number; z: number } | null>(null)

  const [people, setPeople] = useState<SkyPerson[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<number | null>(null)
  /** Who is close enough to be a person rather than a shape. Written from
   *  the camera loop, but only when the answer actually changes — a set
   *  that is the same set is not a re-render. */
  const [detail, setDetail] = useState<ReadonlySet<number>>(NOBODY)
  /** True only while a finger is actually moving the world. The header
   *  steps back during that, and a class is cheaper than a re-render on
   *  every frame. */
  const panning = useRef(false)

  const appRef = useRef<HTMLDivElement>(null)
  const sceneRef = useRef<HTMLDivElement>(null)
  const layerRefs = useRef<Array<HTMLDivElement | null>>([])
  const dustRefs = useRef<Array<HTMLDivElement | null>>([])

  // The camera lives in a ref, not in state: it changes sixty times a
  // second and not one of those changes should re-render React.
  const camera = useRef<Camera>({ x: 0, y: 0, z: 1 })
  const target = useRef<Camera>({ x: 0, y: 0, z: 1 })
  /** True while the camera is travelling somewhere on its own rather than
   *  following a finger. Only the speed differs. */
  const gliding = useRef(false)
  const velocity = useRef({ x: 0, y: 0 })
  const dragging = useRef(false)
  const moved = useRef(false)
  const last = useRef({ x: 0, y: 0 })
  const start = useRef({ x: 0, y: 0 })
  /** A mirror of `detail` the loop can read without being re-created every
   *  time it changes, and the clock that keeps it from being asked too
   *  often. */
  const detailRef = useRef<ReadonlySet<number>>(NOBODY)
  const detailAt = useRef(0)

  useEffect(() => {
    fetchSky()
      .then(setPeople)
      .catch((err) => setError(formatApiError(err)))
  }, [])

  const stars: Star[] = useMemo(() => {
    if (!people) return []
    const spots = place(people.length)
    const random = seededRandom(31)
    return people.map((person, index) => ({
      ...person,
      ...spots[index],
      // Every orb breathes at its own rate and starts part-way through,
      // so the sky never pulses in unison.
      driftSeconds: 10 + random() * 9,
      driftDelay: random() * 16,
    }))
  }, [people])

  const chosen = stars.find((star) => star.user_id === selected) ?? null

  useEffect(() => {
    if (region === shown) return
    // Nobody stays held while you travel: coming back should not find a
    // person still half-chosen.
    setSelected(null)
    // Back from the stair to the world: the people fly home to their places.
    if (shown === 'talk' && region === 'world') {
      setLeaving(true)
      const timer = window.setTimeout(() => {
        setLeaving(false)
        setShown(region)
      }, FLY_HOME_MS + world.relations.length * FLY_HOME_EACH_MS)
      return () => clearTimeout(timer)
    }
    // Into the stair from the world: not a journey — the people are pulled
    // to you where you are.
    if (shown === 'world' && region === 'talk') {
      setShown(region)
      return
    }
    // Anything else is a journey: the place you are in rushes past, the
    // stars stretch, and the new place settles in (the prototype's
    // travelTo, with its timing).
    setJourney('leave')
    navigator.vibrate?.(14)
    let frame = 0
    const timer = window.setTimeout(() => {
      setShown(region)
      setJourney('arrive')
      frame = requestAnimationFrame(() => {
        frame = requestAnimationFrame(() => setJourney(null))
      })
    }, JOURNEY_MS)
    return () => {
      clearTimeout(timer)
      cancelAnimationFrame(frame)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [region, shown])

  // Arriving from a conversation's "see them in the world": hold that
  // person as soon as they are in the sky. Once, and only in the world.
  const heldFromState = useRef(false)
  useEffect(() => {
    const wanted = (location.state as { hold?: number } | null)?.hold
    if (heldFromState.current || wanted === undefined || region !== 'world') return
    const star = stars.find((s) => s.user_id === wanted)
    if (!star) return
    heldFromState.current = true
    hold(star)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stars, region])

  /** Who is pulled onto the stair: their body leaves its place in the
   *  world while they are there, so nobody is ever in two places at once —
   *  and it comes back only once they have landed on it again. */
  const pulled = useMemo(
    () => (shown === 'talk' ? new Set(world.relations.map((r) => r.userId)) : NOBODY),
    [shown, world.relations],
  )
  const liveWith = world.liveSession?.other_participant.user_id ?? null

  /** A place's layer during a journey: rushing past while it is the one
   *  being left, settling in while it is the one arrived at. The world is
   *  simply away while you are in the news, as in the prototype — it is
   *  another place, not a backdrop — and stays, faint, behind the stair. */
  function layerState(place: Region): string {
    const current = place === shown
    if (current && journey === 'leave') return ' is-leaving'
    if (current && journey === 'arrive') return ' is-arriving'
    if (place === 'world' && shown === 'news') return ' is-away'
    return ''
  }

  /** Travel to a region. From the world it is a step forward the back
   *  button undoes; between regions it replaces, so back always lands in
   *  the world rather than walking through every region visited. */
  function go(to: Region) {
    if (to === region) return
    if (to === 'world') {
      if ((location.state as { fromWorld?: boolean } | null)?.fromWorld) navigate(-1)
      else navigate('/sky', { replace: true })
      return
    }
    navigate(`/sky/${to}`, region === 'world' ? { state: { fromWorld: true } } : { replace: true, state: location.state })
  }

  /** Where a person's body is on the glass right now — the point they fly
   *  out of when pulled onto the stair. Asked of camera.ts like every
   *  other question about where somebody is on screen. */
  function originOf(userId: number): { x: number; y: number } | null {
    const star = stars.find((s) => s.user_id === userId)
    return star ? screenOf(star, camera.current, view()) : null
  }

  async function answer(item: NewsItem, yes: boolean) {
    if (item.kind === 'confirm' && item.requestId !== undefined) {
      await (yes ? confirmRequest(item.requestId) : refuseRequest(item.requestId))
    } else if (item.kind === 'follow' && item.followerId !== undefined) {
      await (yes ? acceptFollow(item.followerId) : refuseFollow(item.followerId))
    }
    await world.reload()
  }

  function openNews(item: NewsItem, where?: 'profile') {
    if (where === 'profile') navigate(`/profiles/${item.userId}`)
    else navigate(`/conversations/with/${item.userId}`)
  }

  /** The glass, as the arithmetic sees it. Read fresh every time rather
   *  than remembered: a phone is rotated, and a keyboard opens. */
  function view(): View {
    return { width: innerWidth, height: innerHeight, floor: FLOOR }
  }

  /** The camera loop. The only place any of this writes style. */
  useEffect(() => {
    let frame = 0
    const step = () => {
      const cam = camera.current
      const tgt = target.current
      const vel = velocity.current

      if (!dragging.current && selected === null) {
        tgt.x += vel.x
        tgt.y += vel.y
        vel.x *= FRICTION
        vel.y *= FRICTION
        if (Math.abs(vel.x) < STILL) vel.x = 0
        if (Math.abs(vel.y) < STILL) vel.y = 0
      }

      const ease = gliding.current ? CAMERA_EASE_GLIDE : CAMERA_EASE_DRAG
      Object.assign(cam, stepCamera(cam, tgt, ease))
      // Arrived: hand the camera back so the next drag is immediate
      // rather than syrupy.
      if (gliding.current && hasArrived(cam, tgt)) gliding.current = false

      const scene = sceneRef.current
      if (scene) {
        // The vertical anchor is the middle of the space Sol does not
        // occupy, which is what keeps the centre of the world in sight.
        const anchor = anchorOf(view())
        scene.style.transform = `translate3d(${anchor.x}px, ${anchor.y}px, 0) scale(${cam.z.toFixed(
          3,
        )}) translate3d(${-cam.x}px, ${-cam.y}px, 0)`
      }
      // Nearer layers move further than the camera, which is what reads
      // as depth rather than as a flat poster sliding about. The sign
      // matters and was wrong: the scene already subtracts the camera
      // once, so a layer has to subtract the REMAINDER of its depth, and
      // adding it instead made the near layer the slowest of the three.
      for (let index = 0; index < layerRefs.current.length; index += 1) {
        const layer = layerRefs.current[index]
        if (!layer) continue
        const shift = layerShift(index, cam)
        layer.style.transform = `translate3d(${shift.x.toFixed(1)}px, ${shift.y.toFixed(
          1,
        )}px, 0)`
      }
      for (let index = 0; index < dustRefs.current.length; index += 1) {
        const dust = dustRefs.current[index]
        if (!dust) continue
        const factor = DUST_LAYERS[index]
        dust.style.transform = `translate3d(${(-cam.x * factor).toFixed(1)}px, ${(
          -cam.y * factor
        ).toFixed(1)}px, 0)`
      }

      // Detail is the one thing here that touches React, so it is asked
      // on a clock of its own and only reported when the answer moved.
      const now = performance.now()
      if (now - detailAt.current >= DETAIL_EVERY_MS) {
        detailAt.current = now
        const next = detailAround(stars, cam, view(), detailRef.current)
        if (!sameIds(next, detailRef.current)) {
          detailRef.current = next
          setDetail(next)
        }
      }

      frame = requestAnimationFrame(step)
    }
    frame = requestAnimationFrame(step)
    return () => cancelAnimationFrame(frame)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, stars])

  /** Collects the dust layers the ground rendered, so the loop can move
   *  them. They belong to SpaceGround, which has no idea a camera exists. */
  useEffect(() => {
    const app = appRef.current
    if (!app) return
    dustRefs.current = Array.from(app.querySelectorAll('.cos-dust'))
  }, [people])

  /** What is under this point on the screen, worked out by hand because
   *  pointer capture means a click never reaches an orb. */
  /**
   * What is under this point.
   *
   * Has to reproduce the scene's transform exactly — the same vertical
   * anchor and the same zoom — because the two are the only description
   * of where anything actually is. When they drifted apart, taps landed
   * on whatever used to be there.
   *
   * The catch radius follows the zoom too: pulled out, everything is
   * smaller, and a fixed radius would have one finger covering six
   * people.
   */
  function hitTest(clientX: number, clientY: number): Star | null {
    return hitTestAt(
      stars,
      camera.current,
      view(),
      { x: clientX, y: clientY },
      HIT_RADIUS,
    ) as Star | null
  }

  function onPointerDown(event: React.PointerEvent) {
    // Touching the world takes the camera back off autopilot at once —
    // a glide that keeps going under a finger feels like a stuck screen.
    gliding.current = false
    if ((event.target as HTMLElement).closest('[data-chrome]')) return
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
    // A second finger turns the drag into a pinch. Pulling out is how the
    // whole sky is seen now that a tap on Sol at home opens the menu.
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()]
      pinch.current = { distance: Math.hypot(a.x - b.x, a.y - b.y) || 1, z: target.current.z }
      dragging.current = false
      moved.current = true
      return
    }
    dragging.current = true
    moved.current = false
    last.current = { x: event.clientX, y: event.clientY }
    start.current = { x: event.clientX, y: event.clientY }
    velocity.current = { x: 0, y: 0 }
    appRef.current?.setPointerCapture(event.pointerId)
  }

  function onPointerMove(event: React.PointerEvent) {
    if (pointers.current.has(event.pointerId)) {
      pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
    }
    if (pinch.current && pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()]
      zoomTo(pinch.current.z * (Math.hypot(a.x - b.x, a.y - b.y) / pinch.current.distance))
      return
    }
    if (!dragging.current) return
    const dx = event.clientX - last.current.x
    const dy = event.clientY - last.current.y
    last.current = { x: event.clientX, y: event.clientY }

    if (Math.abs(event.clientX - start.current.x) + Math.abs(event.clientY - start.current.y) > DRAG_SLOP) {
      moved.current = true
      if (!panning.current) {
        panning.current = true
        appRef.current?.classList.add('is-panning')
      }
    }

    // Pulling the world away from somebody lets go of them, and then the
    // same gesture carries on panning. No direction to learn and nothing
    // to aim at: you simply leave, which is what the movement already
    // means everywhere else.
    if (selected !== null && moved.current) release()

    // Divided by the zoom so the world always travels exactly as far as
    // the finger did. Pulled out, a pixel on screen is more than a pixel
    // of world, and without this the drag feels glued while zoomed in and
    // slippery while zoomed out.
    const z = camera.current.z
    target.current.x -= dx / z
    target.current.y -= dy / z
    camera.current.x -= dx / z
    camera.current.y -= dy / z
    velocity.current = { x: -dx / z, y: -dy / z }
  }

  function onPointerUp(event: React.PointerEvent) {
    pointers.current.delete(event.pointerId)
    if (pointers.current.size < 2) pinch.current = null
    if (!dragging.current) return
    dragging.current = false
    // The world has stopped moving, so the header comes back.
    if (panning.current) {
      panning.current = false
      appRef.current?.classList.remove('is-panning')
    }
    if (moved.current) return

    // Pulled out, the world is a map rather than a place. You look at it;
    // you do not reach into it — people are too small to aim at, and
    // holding one out here would open a conversation with somebody you
    // could barely see. A touch means "take me back in, around here".
    if (isWide(target.current)) {
      const there = worldAt({ x: event.clientX, y: event.clientY }, camera.current, view())
      velocity.current = { x: 0, y: 0 }
      gliding.current = true
      target.current = { x: there.x, y: there.y, z: 1 }
      return
    }

    const hit = hitTest(event.clientX, event.clientY)
    // Tap to hold, tap again to let go. Symmetric, so there is nothing to
    // remember — and it is the reason there is no "never mind" button.
    if (!hit || hit.user_id === selected) release()
    else hold(hit)
  }

  function hold(star: Star) {
    setSelected(star.user_id)
    // Bring them to the upper middle of the screen. Doing it this way
    // rather than zooming is what solves an orb near the screen's edge:
    // wherever they were, they end up somewhere there is room to show
    // something about them.
    //
    // The zoom is carried over deliberately. Leaving it out of this object
    // set it to nothing, every arithmetic on it from that moment produced
    // nothing, and the scene's scale became a value the browser could not
    // read — so the world stopped moving and stopped answering taps until
    // the screen was left and come back to. That was the freeze.
    // Not a glide: going to somebody you just pointed at should feel like
    // an answer, not a journey. Only Sol's long trips get the slow ease.
    velocity.current = { x: 0, y: 0 }
    gliding.current = false
    target.current = { x: star.x, y: star.y + innerHeight * HOLD_LIFT, z: camera.current.z }
  }

  function release() {
    setSelected(null)
  }

  /** Zoom, held between the whole sky and life size. Never closer than
   *  life size: a face bigger than it was drawn only shows its pixels. */
  function zoomTo(z: number) {
    const next = Math.min(1, Math.max(WIDE_SCALE, z))
    if (selected !== null) release()
    velocity.current = { x: 0, y: 0 }
    target.current = { ...target.current, z: next }
  }

  if (error) {
    return (
      <div className="cos-screen cos-centre">
        <SpaceGround />
        <p className="cos-message">{error}</p>
      </div>
    )
  }

  return (
    <div
      className={`cos-screen${shown === 'world' || leaving ? '' : ` is-region is-region-${shown}`}${leaving ? ' is-returning' : ''}${journey === 'leave' ? ' is-warping' : ''}`}
      ref={appRef}
      onPointerDownCapture={(event) => {
        if (hintSeen || !(event.target as HTMLElement).closest('.cos-core')) return
        setHintSeen(true)
        try {
          localStorage.setItem('cos-sol-hint-seen', '1')
        } catch {
          // Only costs seeing the hint once more.
        }
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onWheel={(event) => {
        if (shown !== 'world' || (event.target as HTMLElement).closest('[data-chrome]')) return
        zoomTo(target.current.z * (1 - event.deltaY * 0.0015))
      }}
      onPointerCancel={(event) => {
        pointers.current.delete(event.pointerId)
        pinch.current = null
        dragging.current = false
        // A gesture that ends off the edge of the screen still has to give
        // the header back, or it stays dimmed for good.
        panning.current = false
        appRef.current?.classList.remove('is-panning')
      }}
    >
      <SpaceGround />

      {people !== null && people.length > 0 && shown === 'world' && (
        <SkyHeader
          around={people.length}
          present={people.filter((person) => person.online).length}
        />
      )}

      <div className={`cos-world${layerState('world')}`}>
      <div className="cos-scene" ref={sceneRef}>
        {/* Outside the depth layers on purpose: the orbits are the world's
            own frame of reference, so they must not drift against the
            people standing on them. */}
        <Orbits />

        {[0, 1, 2].map((layer) => (
          <div
            className="cos-layer"
            key={layer}
            ref={(element) => {
              layerRefs.current[layer] = element
            }}
          >
            {stars
              .filter((star) => star.layer === layer)
              .map((star) => (
                <div
                  className="cos-star"
                  key={star.user_id}
                  style={{ transform: `translate3d(${star.x}px, ${star.y}px, 0)` }}
                >
                  <div
                    className={[
                      'cos-star-inner',
                      detail.has(star.user_id) ? 'is-near' : '',
                      selected === null ? '' : selected === star.user_id ? 'is-chosen' : 'is-dimmed',
                      pulled.has(star.user_id) ? 'is-pulled' : '',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                  >
                    <Orb
                      initial={star.initial}
                      presence={star.presence}
                      trust={star.trust}
                      online={star.online}
                      isNew={star.is_new}
                      seed={star.user_id}
                      lightFrom={lightTowardsCentre(star.x, star.y)}
                      driftSeconds={star.driftSeconds}
                      driftDelaySeconds={star.driftDelay}
                      photoUrl={star.avatar_url}
                      near={detail.has(star.user_id)}
                      moons={star.moons ?? 0}
                      overlay={
                        liveWith === star.user_id && world.liveSession ? (
                          <SessionClock session={world.liveSession} />
                        ) : undefined
                      }
                    />
                    {/* Always in the document, never always visible: the
                        name fades with distance, and a name that is
                        mounted and unmounted cannot fade. It is taken out
                        of the flow as well, so a body's position never
                        shifts when its name arrives. */}
                    <span className="cos-orb-name">{star.display_name}</span>

                  </div>
                </div>
              ))}
          </div>
        ))}
      </div>
      </div>

      {/* Quiet ground under Sol, so the crowd never runs into the one
          control the world has. */}
      <div className="cos-floor" aria-hidden="true" />

      {people !== null && people.length === 0 && (
        <p className="cos-message" data-chrome>
          {t('sky.empty')}
        </p>
      )}

      {shown === 'talk' && (
        <div className={`cos-region-layer${layerState('talk')}`}>
        <TalkStair
          relations={world.relations}
          loaded={world.loaded}
          originOf={originOf}
          leaving={leaving}
          onOpen={(relation) => navigate(`/conversations/with/${relation.userId}`)}
        />
        </div>
      )}
      {shown === 'news' && (
        <div className={`cos-region-layer${layerState('news')}`}>
        <NewsFeed
          items={world.news}
          loaded={world.loaded}
          onDismiss={world.dismiss}
          onAnswer={answer}
          onOpen={openNews}
        />
        </div>
      )}
      {shown !== 'world' && (
        // Where you are, in the same place and the same voice as the
        // galaxy's name in the world — as in the approved prototype: the
        // region's name, and one quiet line about what is in it.
        <header className="cos-header" data-chrome>
          <span className="cos-header-place" key={shown}>
            <b className="cos-header-name">{t(`world.region.${shown}`)}</b>
          </span>
          <span className="cos-header-count">
            {shown === 'talk'
              ? t('world.talkSub', {
                  n: world.relations.length.toLocaleString(i18n.language),
                  m: world.relations.filter((r) => r.unread).length.toLocaleString(i18n.language),
                })
              : world.news.length > 0
                ? t('world.newsSub', { n: world.news.length.toLocaleString(i18n.language) })
                : t('world.newsSubNone')}
          </span>
        </header>
      )}
      {world.loaded && world.error && shown !== 'world' && (
        <p className="cos-region-note" data-chrome role="status">
          {t('world.loadFailed')}
        </p>
      )}

      {!hintSeen && selected === null && shown === 'world' && (
        // The prototype's first-time hint, until Sol is first touched.
        <p className="cos-sol-hint" aria-hidden="true">{t('sky.solHint')}</p>
      )}

      {/* The one control the world has. Hidden while somebody is chosen:
          never two things asking for the same thumb. */}
      {selected === null && (
        <CoreNav
          // A tap is always one step closer to where you want to be
          // (section 30.12): in a region it brings you back to the world;
          // out in the world, or pulled out to the whole sky, it brings you
          // home; already home, it opens the menu of places.
          onTap={() => {
            if (region !== 'world') {
              go('world')
              return
            }
            const cam = camera.current
            const home = Math.hypot(cam.x, cam.y) < 60
            if (home && !isWide(cam)) return 'menu'
            velocity.current = { x: 0, y: 0 }
            gliding.current = true
            release()
            target.current = { x: 0, y: 0, z: 1 }
          }}
          badge={
            region !== 'news' && world.news.length > 0
              ? {
                  count: world.news.length,
                  label: t('world.newsBadge', { count: world.news.length }),
                  onOpen: () => go('news'),
                }
              : undefined
          }
          sections={[
            {
              id: 'talk',
              label: t('world.region.talk'),
              icon: <MiniTalk />,
              tone: 'var(--cos-talk)',
              // Something waiting on you, or unread, in a conversation.
              alert: world.relations.some((r) => r.unread || NEEDS_YOU.includes(r.stage)),
              onChoose: () => go('talk'),
            },
            {
              id: 'news',
              label: t('world.region.news'),
              icon: <MiniNews count={world.news.length} />,
              tone: 'var(--cos-news)',
              onChoose: () => go('news'),
            },
            {
              // The only place with a name of its own, so the label leads
              // with the name and says what it does underneath — that is
              // the word people will end up using.
              id: 'echo',
              name: t('sky.echoName'),
              sub: t('sky.echoSub'),
              label: t('sky.randomChat'),
              icon: <MiniEcho />,
              tone: 'var(--cos-echo)',
              onChoose: () => navigate('/echo'),
            },
            {
              id: 'me',
              label: t('world.region.me'),
              icon: <MiniMe />,
              tone: 'var(--cos-warm)',
              onChoose: () => navigate('/profile'),
            },
          ]}
        />
      )}

      {/* The two things you can do. No card behind them: a panel would
          be a lid closing over the world, and the world is why you are
          here. Nothing repeats what is already on the person's face
          either — their name and their line are up there, on them. */}
      {chosen && shown === 'world' && (
        <div className="cos-hold-do" data-chrome>
          <button
            className="cos-hold-see"
            onClick={() => navigate(`/profiles/${chosen.user_id}`)}
          >
            {t('sky.viewProfile')}
          </button>
          <button
            className="cos-hold-say"
            onClick={() => navigate(`/conversations/with/${chosen.user_id}`)}
          >
            {/* With the person you are in a paid session with, the one
                thing to do is go back to it. */}
            {t(liveWith === chosen.user_id ? 'world.backToSession' : 'sky.sayHello')}
          </button>
        </div>
      )}

    </div>
  )
}
