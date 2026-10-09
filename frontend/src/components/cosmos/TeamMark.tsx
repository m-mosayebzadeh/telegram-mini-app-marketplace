import { CosmosMark } from './CosmosMark'

/**
 * Cosmos Team's face (TECHNICAL_REQUIREMENTS.md section 37): the app itself
 * writing to you.
 *
 * Round like the faces beside it — the owner wants it to sit in the list
 * like somebody you talk to — but never a photograph or a person's colours:
 * the app's own mark (CosmosMark, section 43) on the night ink. It appears
 * only in conversations; the world never draws it.
 */
export function TeamMark({ className }: { className: string }) {
  return (
    <span className={`${className} cos-team-mark`} role="img" aria-label="Cosmos Team">
      <CosmosMark className="cos-team-mark-art" />
    </span>
  )
}
