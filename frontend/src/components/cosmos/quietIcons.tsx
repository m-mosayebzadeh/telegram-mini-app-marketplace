/**
 * The icons of the quiet pages (styles/cosmos-quiet.css), drawn as in the
 * approved prototype: thin, round-ended, in the colour of the text around
 * them. Arrows are drawn for left-to-right; the stylesheet turns them for
 * a page read right-to-left.
 */

const LINE = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round' } as const

export function QBack() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7" {...LINE} strokeWidth={1.8} /></svg>
}

export function QChevron() {
  return <svg className="cos-q-chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7" {...LINE} strokeWidth={1.8} /></svg>
}

export function QCheck() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" {...LINE} strokeWidth={1.9} /></svg>
}

export function QPerson() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="8.5" r="3.6" {...LINE} />
      <path d="M5 19.5c1.2-3.4 4-5 7-5s5.8 1.6 7 5" {...LINE} />
    </svg>
  )
}

export function QBell() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 1.5h-15zM10 20a2 2 0 0 0 4 0" {...LINE} /></svg>
}

export function QLeaf() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 19c0-8 5-13 14-14 0 9-5 14-13 14zM5 19l7-7" {...LINE} /></svg>
}

export function QFlag() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 20V4.5M6 5h10l-2 3.5 2 3.5H6" {...LINE} /></svg>
}

export function QKey() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="8" cy="14" r="4" {...LINE} />
      <path d="M11 11l8-8M16 6l2 2M14 8l2 2" {...LINE} />
    </svg>
  )
}

export function QDevice() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="7" y="3" width="10" height="18" rx="2.5" {...LINE} />
      <path d="M11 18h2" {...LINE} />
    </svg>
  )
}

export function QTwoDevices() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="3" y="6" width="9" height="12" rx="2" {...LINE} />
      <rect x="14" y="9" width="7" height="9" rx="1.6" {...LINE} />
    </svg>
  )
}

export function QOut() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 5h4.5v14H14M10 8l-4 4 4 4M6 12h9" {...LINE} /></svg>
}
