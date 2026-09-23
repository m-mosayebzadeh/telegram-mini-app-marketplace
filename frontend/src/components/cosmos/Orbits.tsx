/**
 * The orbits everybody stands on.
 *
 * Until now the sky was a scatter of circles at carefully chosen positions
 * and nothing said WHY they were there. The rule behind the placement —
 * that where somebody stands is how near they are to you, and nothing else
 * (TECHNICAL_REQUIREMENTS.md section 23.3) — was invisible, so the world
 * read as decoration rather than as a system with you at the centre of it.
 *
 * These thin rings are that rule, drawn. They are not new information and
 * they are not ornament: they are the existing arrangement made visible,
 * which is the cheapest way there is to make a world look deliberate.
 *
 * Three things keep them out of the way of everything else:
 *
 * - **They fade outwards.** The near rings, where the people you actually
 *   have are, read clearly; the far ones dissolve into the dust. The eye
 *   is drawn inwards, which is where the world is.
 * - **They are cool, never warm.** Warm belongs to Sol and to things that
 *   are yours. A warm ring out here would read as your light reaching a
 *   place it has not reached.
 * - **They are drawn once and never touched again.** No style is written
 *   to them on any frame; the camera moves the scene they sit in. The
 *   seven-writes-per-frame rule (section 23.4) survives untouched.
 */

/** How far apart the rings are, in world px. Tuned against the placement
 *  spacing in phyllotaxis.ts so a ring lands between bands of people
 *  rather than through the middle of one. */
const GAP = 168

/** How many. Enough to reach past the far edge of a crowd of a few hundred
 *  and past the widest the camera ever pulls out to. */
const COUNT = 9

export function Orbits() {
  return (
    <div className="cos-orbits" aria-hidden="true">
      {Array.from({ length: COUNT }, (_, index) => {
        const radius = GAP * (index + 1)
        // Linear fade with distance, floored so the outermost is a hint
        // rather than nothing at all.
        const strength = Math.max(0.08, 1 - index / (COUNT - 1))
        return (
          <span
            key={index}
            className="cos-orbit"
            style={{
              width: `${radius * 2}px`,
              height: `${radius * 2}px`,
              opacity: strength,
            }}
          />
        )
      })}
    </div>
  )
}
