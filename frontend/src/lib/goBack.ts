import { useNavigate } from 'react-router-dom'

/**
 * A back button that really goes back.
 *
 * Going "back" by navigating to the parent page puts a new copy of that
 * page on the history, so the phone's own back gesture then returns to the
 * page just left — Settings → another device → (back) Settings → (back)
 * another device again, the bug the owner found.
 *
 * So: one step back when there is a step in this app to go back to; the
 * parent page only when there is none — a page opened directly, such as
 * "sign in another device" opened by scanning its code, or a page Google
 * just sent the browser back to. Then it replaces this page rather than
 * stacking on it, so back never loops.
 */
export function useGoBack(fallback: string): () => void {
  const navigate = useNavigate()
  return () => {
    // React Router numbers its own history entries; 0 is the first page of
    // this visit, and a page the browser loaded fresh has no number at all.
    const index = (window.history.state as { idx?: number } | null)?.idx ?? 0
    if (index > 0) navigate(-1)
    else navigate(fallback, { replace: true })
  }
}
