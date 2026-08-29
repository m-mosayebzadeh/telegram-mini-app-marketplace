/**
 * Small, minimal line icons for the bottom nav (see App.tsx) — not a
 * copy of Telegram's own icon assets (no access to those files, and no
 * network access to fetch them), just matching the SAME simplicity:
 * thin single-color stroke, no fill, 24x24, `currentColor` so active/
 * inactive coloring is just a CSS color change on the parent button.
 */

type IconProps = { size?: number }

export function IconChat({ size = 24 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path
        d="M4 12c0-4.4 3.6-8 8-8s8 3.6 8 8-3.6 8-8 8c-1.1 0-2.1-.2-3-.6L5 20l1.1-3.6C4.8 15.1 4 13.6 4 12Z"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export function IconActivity({ size = 24 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M12 21s-7-4.4-9.5-8.8C.8 8.8 2.3 5 6 5c2 0 3.3 1.1 4 2.2C10.7 6.1 12 5 14 5c3.7 0 5.2 3.8 3.5 7.2C15 16.6 12 21 12 21Z" />
    </svg>
  )
}

export function IconDiscover({ size = 24 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <circle cx="12" cy="12" r="8.5" />
      <path d="m14.5 9.5-1.8 4.2a1 1 0 0 1-.5.5L8 16l1.8-4.2a1 1 0 0 1 .5-.5L14.5 9.5Z" strokeLinejoin="round" />
    </svg>
  )
}

export function IconPersonFallback({ size = 24 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <circle cx="12" cy="8.5" r="3.5" />
      <path d="M4.5 20c1.4-3.6 4.4-5.5 7.5-5.5S18.1 16.4 19.5 20" strokeLinecap="round" />
    </svg>
  )
}

export function IconCamera({ size = 24 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 8.5A1.5 1.5 0 0 1 5.5 7h2l1-1.6A1.5 1.5 0 0 1 9.8 4.6h4.4a1.5 1.5 0 0 1 1.3.8L16.5 7h2A1.5 1.5 0 0 1 20 8.5v9A1.5 1.5 0 0 1 18.5 19h-13A1.5 1.5 0 0 1 4 17.5v-9Z" />
      <circle cx="12" cy="13" r="3.4" />
    </svg>
  )
}

export function IconEdit({ size = 24 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 20l.9-3.8L15.6 5.5a1.4 1.4 0 0 1 2 0l1.9 1.9a1.4 1.4 0 0 1 0 2L8.8 20.1 4 20Z" />
      <path d="M14 7.5 17.5 11" />
    </svg>
  )
}

// Trash and Download below are adapted from Tabler Icons
// (https://tabler.io/icons, MIT licensed) — the exact outline shapes
// requested for the avatar gallery's delete/download actions, just
// re-set to this file's own strokeWidth (1.8, not Tabler's default 2)
// so they sit visually consistent with every other icon here.
export function IconTrash({ size = 24 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 7l16 0" />
      <path d="M10 11l0 6" />
      <path d="M14 11l0 6" />
      <path d="M5 7l1 12a2 2 0 0 0 2 2h8a2 2 0 0 0 2 -2l1 -12" />
      <path d="M9 7v-3a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v3" />
    </svg>
  )
}

export function IconDownload({ size = 24 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2 -2v-2" />
      <path d="M7 11l5 5l5 -5" />
      <path d="M12 4l0 12" />
    </svg>
  )
}

export function IconWallet({ size = 24 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 7.5A1.5 1.5 0 0 1 5.5 6h11A1.5 1.5 0 0 1 18 7.5V9h-1V7.5a.5.5 0 0 0-.5-.5h-11a.5.5 0 0 0-.5.5v9a.5.5 0 0 0 .5.5H17a.5.5 0 0 0 .5-.5V15h1v1.5A1.5 1.5 0 0 1 17 18H5.5A1.5 1.5 0 0 1 4 16.5v-9Z" />
      <path d="M13 10.5h5.5A1.5 1.5 0 0 1 20 12v1a1.5 1.5 0 0 1-1.5 1.5H13a1.75 1.75 0 0 1 0-4Z" />
      <circle cx="16.6" cy="12.5" r=".7" fill="currentColor" stroke="none" />
    </svg>
  )
}
