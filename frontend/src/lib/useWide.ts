import { useEffect, useState } from 'react'

/** The width from which the app is laid out for a computer (section 43):
 *  the doors in a column at the side, and conversations in two columns. */
export const COMPUTER = '(min-width: 1024px)'

/** Whether the screen is at least as wide as `query` says, kept up to date
 *  as a window is resized. False wherever the browser cannot tell. */
export function useWide(query: string = COMPUTER): boolean {
  const ask = () => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(query).matches
  const [wide, setWide] = useState(ask)
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return
    const list = window.matchMedia(query)
    const changed = () => setWide(list.matches)
    list.addEventListener('change', changed)
    return () => list.removeEventListener('change', changed)
  }, [query])
  return wide
}
