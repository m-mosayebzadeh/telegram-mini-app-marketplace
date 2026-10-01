import { useEffect, useState } from 'react'
import { fetchUnreadCount } from './conversationApi'
import { subscribe } from './live'

/**
 * How many conversations have something unread, for the number on the
 * conversations door and in the list's header.
 *
 * Asked of the server over all conversations, never counted from the list
 * on screen: the list only holds its first page, and counting that page
 * once made the door say "1" while the header said "0" and the unread
 * thread sat unseen on page two. Asked again when a message arrives or is
 * read, and on a slow clock in case the live connection missed something.
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
    const timer = setInterval(read, 30_000)
    const unsubscribe = subscribe((event) => {
      if (event.type === 'message' || event.type === 'read' || event.type === 'ready') void read()
    })
    return () => {
      alive = false
      clearInterval(timer)
      unsubscribe()
    }
  }, [])
  return count
}
