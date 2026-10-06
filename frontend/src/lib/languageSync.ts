// The one i18next instance the app sets up in i18n/config.ts; imported from
// i18next itself so this module does not pull in the React binding.
import i18n from 'i18next'
import { apiFetch } from './api'

/**
 * Tells the server which language the app is shown in (section 37), so
 * what it writes to this person — Cosmos Team's messages, later
 * notifications — is in that language.
 *
 * Said once when it differs from what the server knows, and again only
 * when the language is changed: never on a clock, never on every start.
 * Returns the way to stop listening.
 */
export function keepServerLanguage(known: string | null | undefined): () => void {
  let told: string | null = known ?? null
  const tell = (language: string) => {
    const shown = language.startsWith('fa') ? 'fa' : 'en'
    if (shown === told) return
    told = shown
    apiFetch<void>('/me/language', { method: 'PUT', body: JSON.stringify({ language: shown }) }).catch(() => {
      // Not saved: said again at the next change or the next start.
      told = null
    })
  }
  tell(i18n.language)
  i18n.on('languageChanged', tell)
  return () => i18n.off('languageChanged', tell)
}
