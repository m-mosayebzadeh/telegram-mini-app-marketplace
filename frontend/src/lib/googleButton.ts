/**
 * Google's own sign-in button (Google Identity Services).
 *
 * This way of signing in only works through Google's own button, drawn by
 * its script inside a frame, and the looks Google offers for it do not sit
 * well on our page. So the page draws its own button, in Google's brand
 * colours and our proportions, and lays Google's real one exactly over it,
 * invisible: the tap lands on Google's button, which is what makes Google
 * open its account chooser. Google hands the page a signed token once the
 * person has chosen an account, and the page passes that to the server,
 * which checks it (backend/app/auth/google.py).
 *
 * The script is loaded once, the first time a button is needed, and only
 * on the sign-in page: nobody who is signed in pays for it.
 */

const SCRIPT = 'https://accounts.google.com/gsi/client'

interface GoogleIdentity {
  accounts: {
    id: {
      initialize: (options: { client_id: string; callback: (answer: { credential: string }) => void; ux_mode?: 'popup' }) => void
      renderButton: (element: HTMLElement, options: Record<string, unknown>) => void
    }
  }
}

let loading: Promise<GoogleIdentity> | null = null

function load(): Promise<GoogleIdentity> {
  const ready = (window as unknown as { google?: GoogleIdentity }).google
  if (ready?.accounts?.id) return Promise.resolve(ready)
  if (!loading) {
    loading = new Promise((resolve, reject) => {
      const script = document.createElement('script')
      script.src = SCRIPT
      script.async = true
      script.onload = () => resolve((window as unknown as { google: GoogleIdentity }).google)
      script.onerror = () => {
        loading = null
        reject(new Error('google_unreachable'))
      }
      document.head.appendChild(script)
    })
  }
  return loading
}

/** Draws Google's button into `element`; `onCredential` gets the token. */
export async function renderGoogleButton(
  element: HTMLElement,
  clientId: string,
  language: string,
  onCredential: (credential: string) => void,
): Promise<void> {
  const google = await load()
  google.accounts.id.initialize({ client_id: clientId, callback: (answer) => onCredential(answer.credential), ux_mode: 'popup' })
  google.accounts.id.renderButton(element, {
    // Never seen; sized to cover our own button (Google allows 400px at most).
    theme: 'outline',
    size: 'large',
    text: 'continue_with',
    locale: language,
    width: Math.min(element.clientWidth || 360, 400),
  })
}
