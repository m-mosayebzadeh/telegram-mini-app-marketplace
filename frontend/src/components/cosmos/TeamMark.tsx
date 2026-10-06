/**
 * Cosmos Team's face (TECHNICAL_REQUIREMENTS.md section 37): the app itself
 * writing to you.
 *
 * Round like the faces beside it — the owner wants it to sit in the list
 * like somebody you talk to — but never a photograph or a person's colours:
 * the app's own warm light on the night ink, with its initial. No ring
 * around it: a ring means "online now", and the team is never online.
 * It appears only in conversations; the world never draws it.
 */
export function TeamMark({ className }: { className: string }) {
  return (
    <span className={`${className} cos-team-mark`} role="img" aria-label="Cosmos Team">
      <span aria-hidden="true">C</span>
    </span>
  )
}
