import { useEffect, useState } from 'react'

/**
 * Tracks the browser's own connectivity signal (navigator.onLine plus
 * the window 'online'/'offline' events) for the chat session's
 * connection-lost banner (TECHNICAL_REQUIREMENTS.md section 12).
 *
 * Deliberately just a signal for a banner — losing connection never
 * closes, pauses, or otherwise changes the session's own state; the
 * spec is explicit that a dropped connection must never terminate a
 * session. Nothing that reads this hook's return value is allowed to
 * do anything more than show/hide a "reconnecting" notice.
 *
 * Not unit-tested: like every other hook in this codebase (see
 * lib/MeContext.tsx), this is thin browser-event wiring with no
 * branching logic of its own — the testable logic (pure functions) has
 * already been extracted elsewhere (e.g. lib/chatTime.ts).
 */
export function useOnlineStatus(): boolean {
  const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine))

  useEffect(() => {
    function handleOnline() {
      setOnline(true)
    }
    function handleOffline() {
      setOnline(false)
    }
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [])

  return online
}
