import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { IconCheck, IconClose } from '../icons'

/**
 * Toast — docs/design-system/02-components.md#حالت‌ها
 *
 * The success state. It floats above the bottom nav for 3.5 seconds and
 * blocks nothing: confirming that something worked should never cost the
 * user a tap. Anything that DOES need a decision is a dialog, not this.
 *
 * One provider at the app root replaces the copy of this logic that each
 * page had grown for itself — which is how the product ended up with
 * toasts that timed out after 2.2s in one place and 3s in another.
 */

type ToastKind = 'success' | 'error'

interface ToastState {
  text: string
  kind: ToastKind
  /** Changes on every call so a repeated identical message still
   *  restarts the timer instead of appearing not to fire. */
  id: number
}

interface ToastApi {
  success: (text: string) => void
  error: (text: string) => void
}

const ToastContext = createContext<ToastApi | null>(null)

const VISIBLE_MS = 3500
/** Matches --motion-base, so the element leaves only once its exit
 *  animation has actually played. */
const LEAVE_MS = 200

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ToastState | null>(null)
  const [leaving, setLeaving] = useState(false)

  const show = useCallback((text: string, kind: ToastKind) => {
    setLeaving(false)
    // Derived from the previous state rather than a ref, so two calls in
    // the same tick cannot land on the same id.
    setToast((previous) => ({ text, kind, id: (previous?.id ?? 0) + 1 }))
  }, [])

  // Stable, so a consumer can safely list it as an effect dependency.
  const api = useMemo<ToastApi>(
    () => ({
      success: (text: string) => show(text, 'success'),
      error: (text: string) => show(text, 'error'),
    }),
    [show],
  )

  useEffect(() => {
    if (!toast) return
    const hide = setTimeout(() => setLeaving(true), VISIBLE_MS)
    const remove = setTimeout(() => setToast(null), VISIBLE_MS + LEAVE_MS)
    return () => {
      clearTimeout(hide)
      clearTimeout(remove)
    }
    // Keyed on id, not on the object, so an identical repeated message
    // still resets both timers.
  }, [toast?.id])

  return (
    <ToastContext.Provider value={api}>
      {children}
      {toast && (
        <div
          className={`ui-toast ui-toast-${toast.kind}${leaving ? ' ui-toast-leaving' : ''}`}
          // polite, not assertive: this is confirmation, and it should
          // not cut off whatever the screen reader is in the middle of.
          role="status"
          aria-live="polite"
        >
          <span className="ui-toast-mark">
            {toast.kind === 'success' ? <IconCheck size={18} /> : <IconClose size={18} />}
          </span>
          {toast.text}
        </div>
      )}
    </ToastContext.Provider>
  )
}

export function useToast(): ToastApi {
  const api = useContext(ToastContext)
  if (!api) throw new Error('useToast must be used inside <ToastProvider>')
  return api
}
