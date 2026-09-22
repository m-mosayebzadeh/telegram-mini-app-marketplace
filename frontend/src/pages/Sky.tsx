import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Orb } from '../components/cosmos/Orb'
import { SpaceGround, DUST_LAYERS, seededRandom } from '../components/cosmos/SpaceGround'
import { CoreNav } from '../components/cosmos/CoreNav'
import { LAYER_DEPTH, lightTowardsCentre, place } from '../lib/phyllotaxis'
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
 * Choosing somebody happens in two stages and they are never on screen at
 * once: a look first, actions second, and the actions always inside the
 * thumb's reach rather than around a floating orb where the top of a
 * circular menu falls off the screen.
 */

/** How fast a flick keeps travelling, and when it is considered stopped. */
const FRICTION = 0.935
const STILL = 0.02
/** How quickly the camera catches up with where it is heading. Low enough
 *  to feel like weight, high enough not to feel like lag. */
const CAMERA_EASE = 0.14

/** A movement bigger than this is a drag, not a tap. In CSS pixels, and
 *  generous: fingers move a little on every tap. */
const DRAG_SLOP = 9

/** How far from an orb's centre still counts as hitting it. */
const HIT_RADIUS = 46

type Stage = 'none' | 'looking' | 'acting'

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
  const [stage, setStage] = useState<Stage>('none')

  const appRef = useRef<HTMLDivElement>(null)
  const sceneRef = useRef<HTMLDivElement>(null)
  const layerRefs = useRef<Array<HTMLDivElement | null>>([])
  const dustRefs = useRef<Array<HTMLDivElement | null>>([])

  // The camera lives in a ref, not in state: it changes sixty times a
  // second and not one of those changes should re-render React.
  const camera = useRef({ x: 0, y: 0 })
  const target = useRef({ x: 0, y: 0 })
  const velocity = useRef({ x: 0, y: 0 })
  const dragging = useRef(false)
  const moved = useRef(false)
  const last = useRef({ x: 0, y: 0 })
  const start = useRef({ x: 0, y: 0 })

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

  /** The camera loop. The only place any of this writes style. */
  useEffect(() => {
    let frame = 0
    const step = () => {
      const cam = camera.current
      const tgt = target.current
      const vel = velocity.current

      if (!dragging.current && stage === 'none') {
        tgt.x += vel.x
        tgt.y += vel.y
        vel.x *= FRICTION
        vel.y *= FRICTION
        if (Math.abs(vel.x) < STILL) vel.x = 0
        if (Math.abs(vel.y) < STILL) vel.y = 0
      }

      cam.x += (tgt.x - cam.x) * CAMERA_EASE
      cam.y += (tgt.y - cam.y) * CAMERA_EASE

      const scene = sceneRef.current
      if (scene) {
        scene.style.transform = `translate3d(${innerWidth / 2}px, ${
          innerHeight / 2
        }px, 0) translate3d(${-cam.x}px, ${-cam.y}px, 0)`
      }
      // Nearer layers move further than the camera, which is what reads
      // as depth rather than as a flat poster sliding about.
      for (let index = 0; index < layerRefs.current.length; index += 1) {
        const layer = layerRefs.current[index]
        if (!layer) continue
        const factor = LAYER_DEPTH[index] - 1
        layer.style.transform = `translate3d(${(cam.x * factor).toFixed(1)}px, ${(
          cam.y * factor
        ).toFixed(1)}px, 0)`
      }
      for (let index = 0; index < dustRefs.current.length; index += 1) {
        const dust = dustRefs.current[index]
        if (!dust) continue
        const factor = DUST_LAYERS[index]
        dust.style.transform = `translate3d(${(-cam.x * factor).toFixed(1)}px, ${(
          -cam.y * factor
        ).toFixed(1)}px, 0)`
      }

      frame = requestAnimationFrame(step)
    }
    frame = requestAnimationFrame(step)
    return () => cancelAnimationFrame(frame)
  }, [stage])

  /** Collects the dust layers the ground rendered, so the loop can move
   *  them. They belong to SpaceGround, which has no idea a camera exists. */
  useEffect(() => {
    const app = appRef.current
    if (!app) return
    dustRefs.current = Array.from(app.querySelectorAll('.cos-dust'))
  }, [people])

  /** What is under this point on the screen, worked out by hand because
   *  pointer capture means a click never reaches an orb. */
  function hitTest(clientX: number, clientY: number): Star | null {
    const cam = camera.current
    let best: Star | null = null
    let bestDistance = HIT_RADIUS
    for (const star of stars) {
      const factor = LAYER_DEPTH[star.layer]
      const screenX = innerWidth / 2 + (star.x - cam.x) * factor
      const screenY = innerHeight / 2 + (star.y - cam.y) * factor
      const distance = Math.hypot(clientX - screenX, clientY - screenY)
      if (distance < bestDistance) {
        bestDistance = distance
        best = star
      }
    }
    return best
  }

  function onPointerDown(event: React.PointerEvent) {
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
    }

    // While somebody is chosen, a vertical drag means "bring them closer"
    // or "let them go" rather than turning the world. Neither happens
    // until the gesture's direction is clear.
    if (stage !== 'none') {
      const totalY = event.clientY - start.current.y
      const totalX = event.clientX - start.current.x
      if (Math.abs(totalY) > 24 && Math.abs(totalY) > Math.abs(totalX) * 1.2) {
        dragging.current = false
        if (totalY < 0) setStage('acting')
        else if (stage === 'acting') setStage('looking')
        else unfocus()
        return
      }
      if (Math.abs(totalX) > 24) unfocus()
      else return
    }

    target.current.x -= dx
    target.current.y -= dy
    camera.current.x -= dx
    camera.current.y -= dy
    velocity.current = { x: -dx, y: -dy }
  }

  function onPointerUp(event: React.PointerEvent) {
    if (!dragging.current) return
    dragging.current = false
    if (moved.current) return

    const hit = hitTest(event.clientX, event.clientY)
    if (hit) {
      if (hit.user_id === selected) setStage(stage === 'acting' ? 'looking' : 'acting')
      else focusOn(hit)
    } else {
      unfocus()
    }
  }

  function focusOn(star: Star) {
    setSelected(star.user_id)
    setStage('looking')
    // Bring them to the upper middle of the screen. Doing it this way
    // rather than zooming is what solves an orb near the screen's edge:
    // wherever they were, they end up somewhere there is room to show
    // something about them.
    target.current = { x: star.x, y: star.y + innerHeight * 0.16 }
  }

  function unfocus() {
    setSelected(null)
    setStage('none')
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
      }}
    >
      <SpaceGround />

      <div className="cos-scene" ref={sceneRef}>
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
                    />
                    <span className="cos-orb-name">{star.display_name}</span>
                  </div>
                </div>
              ))}
          </div>
        ))}
      </div>

      {people !== null && people.length === 0 && (
        <p className="cos-message" data-chrome>
          {t('sky.empty')}
        </p>
      )}

      {/* The one control the world has. Hidden while somebody is chosen:
          never two things asking for the same thumb. */}
      {stage === 'none' && (
        <CoreNav
          sections={[
            { id: 'chats', label: t('sky.conversations'), onChoose: () => navigate('/chats') },
            { id: 'random', label: t('sky.randomChat'), onChoose: () => navigate('/random') },
            { id: 'activity', label: t('sky.activity'), onChoose: () => navigate('/activity') },
            { id: 'me', label: t('sky.me'), onChoose: () => navigate('/profile') },
          ]}
        />
      )}

      {/* Stage one: a look. No buttons at all — just who they are. */}
      {chosen && stage === 'looking' && (
        <div className="cos-peek" data-chrome>
          <span className="cos-peek-name">{chosen.display_name}</span>
          {chosen.online && <span className="cos-peek-live">{t('sky.hereNow')}</span>}
          {chosen.tagline && <p className="cos-peek-line">{chosen.tagline}</p>}
          <span className="cos-peek-hint">{t('sky.pullUp')}</span>
        </div>
      )}

      {/* Stage two: what you can do, always within reach of a thumb. The
          card above is gone by now — never two things at once. */}
      {chosen && stage === 'acting' && (
        <div className="cos-actions" data-chrome>
          <div className="cos-actions-who">
            <Orb
              initial={chosen.initial}
              presence={chosen.presence}
              trust={chosen.trust}
              online={chosen.online}
              isNew={chosen.is_new}
              seed={chosen.user_id}
            />
            <div>
              <div className="cos-actions-name">{chosen.display_name}</div>
              {chosen.tagline && <div className="cos-actions-line">{chosen.tagline}</div>}
            </div>
          </div>
          <button className="cos-action" onClick={() => navigate(`/profiles/${chosen.user_id}`)}>
            {t('sky.viewProfile')}
          </button>
          <button
            className="cos-action cos-action-primary"
            onClick={() => navigate(`/conversations/with/${chosen.user_id}`)}
          >
            {t('sky.sayHello')}
          </button>
          <button className="cos-action cos-action-quiet" onClick={unfocus}>
            {t('sky.back')}
          </button>
        </div>
      )}
    </div>
  )
}
