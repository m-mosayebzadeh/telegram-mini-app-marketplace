import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Orb } from '../components/cosmos/Orb'
import { SpaceGround, DUST_LAYERS, seededRandom } from '../components/cosmos/SpaceGround'
import { Orbits } from '../components/cosmos/Orbits'
import { CoreNav } from '../components/cosmos/CoreNav'
import { SkyHeader } from '../components/cosmos/SkyHeader'
import { IconActivity, IconChats, IconEcho, IconMe } from '../components/cosmos/icons'
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
  stepCamera,
  type Camera,
  type View,
} from '../lib/camera'
import { fetchSky, type SkyPerson } from '../lib/skyApi'
import { formatApiError } from '../lib/api'

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

/** How far out the camera pulls to show the whole sky at once. */
const WIDE_SCALE = 0.42

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
  const { t } = useTranslation()
  const navigate = useNavigate()

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
    dragging.current = true
    moved.current = false
    last.current = { x: event.clientX, y: event.clientY }
    start.current = { x: event.clientX, y: event.clientY }
    velocity.current = { x: 0, y: 0 }
    appRef.current?.setPointerCapture(event.pointerId)
  }

  function onPointerMove(event: React.PointerEvent) {
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
      className="cos-screen"
      ref={appRef}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => {
        dragging.current = false
        // A gesture that ends off the edge of the screen still has to give
        // the header back, or it stays dimmed for good.
        panning.current = false
        appRef.current?.classList.remove('is-panning')
      }}
    >
      <SpaceGround />

      {people !== null && people.length > 0 && (
        <SkyHeader
          around={people.length}
          present={people.filter((person) => person.online).length}
        />
      )}

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

      {/* Quiet ground under Sol, so the crowd never runs into the one
          control the world has. */}
      <div className="cos-floor" aria-hidden="true" />

      {people !== null && people.length === 0 && (
        <p className="cos-message" data-chrome>
          {t('sky.empty')}
        </p>
      )}

      {/* The one control the world has. Hidden while somebody is chosen:
          never two things asking for the same thumb. */}
      {selected === null && (
        <CoreNav
          // On the world itself a tap brings the camera home rather than
          // navigating: going to where you already are is not a journey.
          // The easing in the loop turns it into a glide by itself.
          // Two stages, because a tap should always do the most useful
          // thing available. Anywhere in the world it brings you home;
          // once you are already home there is nothing left to come back
          // to, so it pulls out instead and shows the whole sky. Tapping
          // again from out there brings you back in.
          onTap={() => {
            const cam = camera.current
            const home = Math.hypot(cam.x, cam.y) < 60
            const wide = isWide(cam)
            velocity.current = { x: 0, y: 0 }
            gliding.current = true
            // Whoever was being held is let go on the way out: the map
            // cannot hold anybody, and coming back in should not find a
            // conversation still half-open.
            release()
            target.current =
              home && !wide ? { x: 0, y: 0, z: WIDE_SCALE } : { x: 0, y: 0, z: 1 }
          }}
          sections={[
            {
              id: 'chats',
              label: t('sky.conversations'),
              icon: <IconChats size={32} />,
              onChoose: () => navigate('/chats'),
            },
            {
              // The only section with a name of its own, so the label
              // leads with the mark and the name and says what it does
              // underneath — that is the word people will end up using.
              id: 'echo',
              name: t('sky.echoName'),
              sub: t('sky.echoSub'),
              label: t('sky.randomChat'),
              icon: <IconEcho size={32} />,
              onChoose: () => navigate('/echo'),
            },
            {
              id: 'activity',
              label: t('sky.activity'),
              icon: <IconActivity size={32} />,
              onChoose: () => navigate('/activity'),
            },
            {
              id: 'me',
              label: t('sky.me'),
              icon: <IconMe size={32} />,
              onChoose: () => navigate('/profile'),
            },
          ]}
        />
      )}

      {/* The two things you can do. No card behind them: a panel would
          be a lid closing over the world, and the world is why you are
          here. Nothing repeats what is already on the person's face
          either — their name and their line are up there, on them. */}
      {chosen && (
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
            {t('sky.sayHello')}
          </button>
        </div>
      )}

    </div>
  )
}
