import { useEffect, useState } from 'react'
import { fetchUnreadCount } from './conversationApi'
import { subscribe } from './live'
import { onReturn } from './onReturn'

/**
 * How many conversations have something unread, for the number on the
 * conversations door and in the list's header.
 *
 * Asked of the server over all conversations, never counted from the list
 * on screen: the list only holds its first page, and counting that page
 * once made the door say "1" while the header said "0" and the unread
 * thread sat unseen on page two. Asked again only when something happens:
 * a message arrives, something is read or cleared, the live connection
 * comes back, or the person returns to the app. Never on a clock
 * (section 32: the server says when; the app does not keep asking).
 */
export function useUnread(): number {
  const [count, setCount] = useState(0)
  useEffect(() => {
    let alive = true
    const read = () =>
      fetchUnreadCount()
        .then((n) => {
          if (alive && typeof n === 'number') setCount(n)
        })
        .catch(() => {})
    void read()
    const unsubscribe = subscribe((event) => {
      if (event.type === 'message' || event.type === 'read' || event.type === 'ready' || event.type === 'cleared') void read()
    })
    const stopReturn = onReturn(() => void read())
    return () => {
      alive = false
      unsubscribe()
      stopReturn()
    }
  }, [])
  return count
}
