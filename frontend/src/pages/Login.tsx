import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { setDevUserChoice } from '../lib/session'
import { PageHeader, ErrorState } from '../components/ui'
import { IconChevron, IconPersonFallback } from '../components/icons'

/**
 * Shown instead of the whole app whenever there's no real Telegram
 * launch AND no test user has been chosen yet for this browser tab
 * (see lib/session.ts's needsDevLogin(), checked in App.tsx). Never
 * reachable inside real Telegram — there, initData comes from the
 * launch itself and there's nothing to choose.
 *
 * Sara and Bob are the same two users the Bruno collection and the
 * backend's dev endpoint already default to (see
 * backend/app/dev/router.py and bruno/environments/local.bru), so a
 * request one of them creates in the browser is the same account
 * Bruno would see, and vice versa. Soheil and Fatemeh are extra test
 * accounts for manual multi-user testing (e.g. two-browser chat testing).
 */
const TEST_USERS = [
  { telegramId: 111222333, firstName: 'Sara', username: 'sara_dev' },
  { telegramId: 222222, firstName: 'Bob', username: 'bob_dev' },
  { telegramId: 333333, firstName: 'Soheil', username: 'soheil_dev' },
  { telegramId: 444444, firstName: 'Fatemeh', username: 'fatemeh_dev' },
]

export default function Login() {
  const { t } = useTranslation()
  const [error, setError] = useState<string | null>(null)

  async function loginAs(user: (typeof TEST_USERS)[number]) {
    setError(null)
    const params = new URLSearchParams({
      telegram_id: String(user.telegramId),
      first_name: user.firstName,
      username: user.username,
    })
    let response: Response
    try {
      response = await fetch(`/api/dev/test-init-data?${params}`)
    } catch {
      setError(t('login.failed'))
      return
    }
    if (!response.ok) {
      setError(t('login.failed'))
      return
    }
    const { init_data: initData } = (await response.json()) as { init_data: string }
    setDevUserChoice(initData)
    // A full reload (not just a state update) so every module that
    // caches things at load time — most importantly api.ts's own
    // initData cache — starts clean and picks up the freshly stored
    // choice, instead of us having to hunt down and reset each one by
    // hand.
    window.location.reload()
  }

  return (
    <div className="ui-page">
      {/* No back: this replaces the whole app until a user is chosen. */}
      <PageHeader title={t('login.title')} />

      <div className="ui-page-body">
        {error ? (
          <ErrorState text={error} onRetry={() => setError(null)} />
        ) : (
          <div className="ui-list">
            {TEST_USERS.map((user) => (
              <button
                type="button"
                className="ui-row ui-row-avatar"
                key={user.telegramId}
                onClick={() => loginAs(user)}
              >
                <span className="ui-row-media">
                  <IconPersonFallback size={22} />
                </span>
                <span className="ui-row-main">
                  <span className="ui-row-title">{user.firstName}</span>
                  <span className="ui-row-subtitle">@{user.username}</span>
                </span>
                <span className="ui-row-trailing">
                  {t('login.noPassword')}
                  <IconChevron size={20} className="ui-row-chevron" />
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
