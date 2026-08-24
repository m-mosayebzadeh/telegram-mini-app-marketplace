/**
 * Which "test user" a plain-browser (no real Telegram) session is
 * logged in as — see pages/Login.tsx. This is entirely separate from
 * api.ts's own initData caching: this module only tracks the CHOICE
 * (persisted across page reloads within one browser tab, via
 * sessionStorage), while api.ts is what actually reads it and attaches
 * it to every request.
 *
 * None of this runs inside real Telegram at all — there, initData
 * comes from the launch itself, and there's nothing to choose.
 */

import { retrieveRawInitData } from '@telegram-apps/sdk-react'

const DEV_INIT_DATA_KEY = 'devInitData'

/** True when launched for real inside Telegram (real initData is
 * available) — see the matching try/catch pattern in api.ts's
 * getInitData(), which is why this needs a try/catch too. */
export function isRealTelegramLaunch(): boolean {
  try {
    return !!retrieveRawInitData()
  } catch {
    return false
  }
}

/** The initData for whichever test user was chosen on the Login
 * screen, if any. sessionStorage access is wrapped in try/catch since
 * it can throw in some contexts (private browsing, storage disabled) —
 * treating that the same as "nothing chosen yet" is a safe fallback,
 * not a crash. */
export function getDevUserChoice(): string | null {
  try {
    return sessionStorage.getItem(DEV_INIT_DATA_KEY)
  } catch {
    return null
  }
}

export function setDevUserChoice(initData: string): void {
  try {
    sessionStorage.setItem(DEV_INIT_DATA_KEY, initData)
  } catch {
    // Best-effort — if storage isn't available, the app will just ask
    // to log in again next render, which is safe.
  }
}

export function clearDevUserChoice(): void {
  try {
    sessionStorage.removeItem(DEV_INIT_DATA_KEY)
  } catch {
    // no-op — nothing to clear if storage isn't available anyway
  }
}

/** Whether App.tsx should show the Login screen instead of the app:
 * only when there's neither a real Telegram launch nor a previously
 * chosen test user. */
export function needsDevLogin(): boolean {
  return !isRealTelegramLaunch() && !getDevUserChoice()
}
