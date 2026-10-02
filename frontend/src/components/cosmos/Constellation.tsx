import { useId } from 'react'
import type { FriendPerson } from '../../lib/friendsApi'

/**
 * Friends drawn as a constellation (section 32, step 4, the approved "me"
 * prototype): faces are stars, and a fine line between two is a bond.
 *
 * Two pictures:
 *
 * - **Yours** (the friends page, "constellation" view): your friends in
 *   the order they became friends, joined one to the next; a request is a
 *   star not joined yet, reached by a dashed line and slowly blinking —
 *   tapping it says yes.
 * - **Where two skies meet** (somebody else's page): their sky on one side,
 *   yours on the other, and the friends you share in the middle, reached by
 *   lines from both sides. Shared is said by place, lines and words, not by
 *   colour alone, and nobody gets a ring around them (a ring means online).
 *
 * Both scale: yours winds down the page in rows of four, so eighty friends
 * are a longer sky rather than a tangle; the meeting shows a few of each
 * side and says how many more there are.
 */

/** The sky is drawn on a fixed 360-wide canvas and scales to the screen. */
export const SKY_WIDTH = 360
const PER_ROW = 4
const ROW_HEIGHT = 92
const TOP = 46

export interface Point {
  x: number
  y: number
}

/**
 * Where each of `count` stars sits in your constellation: a path that
 * snakes down the page, four to a row, nudged a little off the grid so it
 * reads as a sky rather than a table. Right to left, like the page.
 */
export function constellationLayout(count: number): { points: Point[]; height: number } {
  const columns = [300, 220, 140, 60]
  const nudge = [0, -16, 12, -8, 14, -10]
  const points: Point[] = []
  for (let i = 0; i < count; i++) {
    const row = Math.floor(i / PER_ROW)
    const col = i % PER_ROW
    // Odd rows run back the other way, so each line is short.
    const x = columns[row % 2 === 0 ? col : PER_ROW - 1 - col]
    const y = TOP + row * ROW_HEIGHT + nudge[(i + row) % nudge.length]
    points.push({ x, y })
  }
  const rows = Math.max(1, Math.ceil(count / PER_ROW))
  return { points, height: TOP + (rows - 1) * ROW_HEIGHT + 60 }
}

/** How many of each side the meeting picture shows. */
export const MEET_SIDE = 4
export const MEET_SHARED = 4

/**
 * Their sky on the right (the page runs right to left, and it is their
 * page), yours on the left, the shared ones down the middle.
 */
export function meetingLayout(theirs: number, mine: number, shared: number) {
  const t = Math.min(theirs, MEET_SIDE)
  const m = Math.min(mine, MEET_SIDE)
  const s = Math.min(shared, MEET_SHARED)
  const rows = Math.max(t, m, s, 1)
  const step = 74
  const height = 40 + (rows - 1) * step + 70
  const column = (count: number, x: number, swing: number): Point[] =>
    Array.from({ length: count }, (_, i) => ({
      x: x + (i % 2 === 0 ? 0 : swing),
      y: 40 + i * step + ((rows - count) * step) / 2,
    }))
  return {
    theirs: column(t, 318, -36),
    mine: column(m, 42, 36),
    shared: column(s, SKY_WIDTH / 2, 0),
    height,
  }
}

function Star({ person, at, r, className, onTap, label }: {
  person: FriendPerson
  at: Point
  r: number
  className?: string
  onTap?: () => void
  label?: string
}) {
  const clip = useId()
  const interactive = !!onTap
  return (
    <g
      className={className}
      role={interactive ? 'button' : undefined}
      tabIndex={interactive ? 0 : undefined}
      aria-label={label}
      onClick={onTap}
      onKeyDown={(event) => {
        if (interactive && (event.key === 'Enter' || event.key === ' ')) {
          event.preventDefault()
          onTap!()
        }
      }}
      style={interactive ? { cursor: 'pointer' } : undefined}
    >
      <defs>
        <clipPath id={clip}>
          <circle cx={at.x} cy={at.y} r={r} />
        </clipPath>
      </defs>
      <circle cx={at.x} cy={at.y} r={r + 5} className="cos-star-halo" />
      {person.avatar_url ? (
        <image href={person.avatar_url} x={at.x - r} y={at.y - r} width={r * 2} height={r * 2} clipPath={`url(#${clip})`} preserveAspectRatio="xMidYMid slice" />
      ) : (
        <>
          <circle cx={at.x} cy={at.y} r={r} className="cos-star-blank" />
          <text x={at.x} y={at.y + r * 0.35} textAnchor="middle" className="cos-star-initial" fontSize={r}>
            {person.display_name.slice(0, 1)}
          </text>
        </>
      )}
      <text x={at.x} y={at.y + r + 13} textAnchor="middle" className="cos-star-name">
        {person.display_name}
      </text>
    </g>
  )
}

const Line = ({ a, b, kind }: { a: Point; b: Point; kind: 'mine' | 'theirs' | 'both' | 'asking' }) => (
  <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} className={`cos-sky-line is-${kind}`} />
)

/** Your constellation: friends joined in order, requests still reaching in. */
export function MyConstellation({
  friends,
  requests,
  onAccept,
  label,
  requestLabel,
}: {
  friends: FriendPerson[]
  requests: FriendPerson[]
  onAccept: (person: FriendPerson) => void
  label: string
  requestLabel: (person: FriendPerson) => string
}) {
  const all = [...friends, ...requests]
  const { points, height } = constellationLayout(all.length)
  const lastFriend = friends.length > 0 ? points[friends.length - 1] : null
  return (
    <svg className="cos-sky" viewBox={`0 0 ${SKY_WIDTH} ${height}`} role="img" aria-label={label}>
      {friends.slice(1).map((person, i) => (
        <Line key={`l${person.user_id}`} a={points[i]} b={points[i + 1]} kind="mine" />
      ))}
      {lastFriend &&
        requests.map((person, i) => (
          <Line key={`r${person.user_id}`} a={lastFriend} b={points[friends.length + i]} kind="asking" />
        ))}
      {friends.map((person, i) => (
        <Star key={person.user_id} person={person} at={points[i]} r={17} />
      ))}
      {requests.map((person, i) => (
        <Star
          key={person.user_id}
          person={person}
          at={points[friends.length + i]}
          r={17}
          className="cos-star-asking"
          onTap={() => onAccept(person)}
          label={requestLabel(person)}
        />
      ))}
    </svg>
  )
}

/** Where your sky and theirs meet. */
export function MeetingSky({
  theirs,
  mine,
  shared,
  label,
}: {
  /** Their friends you do not share. */
  theirs: FriendPerson[]
  /** Your friends they do not share. */
  mine: FriendPerson[]
  shared: FriendPerson[]
  label: string
}) {
  const at = meetingLayout(theirs.length, mine.length, shared.length)
  const t = theirs.slice(0, MEET_SIDE)
  const m = mine.slice(0, MEET_SIDE)
  const s = shared.slice(0, MEET_SHARED)
  // Each shared star is reached from the nearest star on either side.
  const nearest = (side: Point[], to: Point) =>
    side.reduce((best, p) => (Math.abs(p.y - to.y) < Math.abs(best.y - to.y) ? p : best), side[0])
  return (
    <svg className="cos-sky" viewBox={`0 0 ${SKY_WIDTH} ${at.height}`} role="img" aria-label={label}>
      <defs>
        <radialGradient id="cos-meet-glow">
          <stop offset="0" className="cos-meet-glow-in" />
          <stop offset="1" className="cos-meet-glow-out" />
        </radialGradient>
      </defs>
      {at.shared.map((p, i) => (
        <circle key={`g${i}`} cx={p.x} cy={p.y} r={38} fill="url(#cos-meet-glow)" />
      ))}
      {at.theirs.slice(1).map((p, i) => <Line key={`t${i}`} a={at.theirs[i]} b={p} kind="theirs" />)}
      {at.mine.slice(1).map((p, i) => <Line key={`m${i}`} a={at.mine[i]} b={p} kind="mine" />)}
      {at.shared.slice(1).map((p, i) => <Line key={`s${i}`} a={at.shared[i]} b={p} kind="both" />)}
      {at.shared.map((p, i) => (
        <g key={`x${i}`}>
          {at.theirs.length > 0 && <Line a={nearest(at.theirs, p)} b={p} kind="theirs" />}
          {at.mine.length > 0 && <Line a={nearest(at.mine, p)} b={p} kind="mine" />}
        </g>
      ))}
      {t.map((person, i) => <Star key={person.user_id} person={person} at={at.theirs[i]} r={14} />)}
      {m.map((person, i) => <Star key={person.user_id} person={person} at={at.mine[i]} r={14} />)}
      {s.map((person, i) => <Star key={person.user_id} person={person} at={at.shared[i]} r={20} />)}
    </svg>
  )
}
