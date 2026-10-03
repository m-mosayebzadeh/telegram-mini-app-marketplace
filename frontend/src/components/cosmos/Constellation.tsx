import { useId } from 'react'
import type { FriendPerson } from '../../lib/friendsApi'
import { SKY_WIDTH, MEET_SIDE, MEET_SHARED, meetingLayout, type Point } from './meetingLayout'

/**
 * Where two skies meet (section 32, step 4, the approved "me" prototype):
 * on somebody else's page, their sky on one side, yours on the other, and
 * the friends you share in the middle, reached by lines from both sides.
 * Faces are stars and a fine line between two is a bond. Shared is said by
 * place, lines and words, not by colour alone, and nobody gets a ring
 * around them (a ring means online).
 *
 * It scales by showing a few of each side and saying how many more there
 * are. Your own friends used to have a constellation view too; the owner
 * removed it (a second way of showing the same list only asked people to
 * choose), so this picture is the one place friends are drawn as stars.
 */

function Star({ person, at, r }: { person: FriendPerson; at: Point; r: number }) {
  const clip = useId()
  return (
    <g>
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

const Line = ({ a, b, kind }: { a: Point; b: Point; kind: 'mine' | 'theirs' | 'both' }) => (
  <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} className={`cos-sky-line is-${kind}`} />
)

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
