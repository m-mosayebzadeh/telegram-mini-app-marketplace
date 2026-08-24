import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Cell, List, Section } from '@telegram-apps/telegram-ui'
import { setDevUserChoice } from '../lib/session'

/**
 * Shown instead of the whole app whenever there's no real Telegram
 * launch AND no test user has been chosen yet for this browser tab
 * (see lib/session.ts's needsDevLogin(), checked in App.tsx). Never
 * reachable inside real Telegram — there, initData comes from the
 * launch itself and there's nothing to choose.
 *
 * The two users here are the same ones the Bruno collection and the
 * backend's dev endpoint already default to (Sara / Bob — see
 * backend/app/dev/router.py and bruno/environments/local.bru), so a
 * request one of them creates in the browser is the same account
 * Bruno would see, and vice versa.
 */
const TEST_USERS = [
  { telegramId: 111222333, firstName: 'Sara', username: 'sara_dev' },
  { telegramId: 222222, firstName: 'Bob', username: 'bob_dev' },
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
    <List>
      <Section header={t('login.title')}>
        {TEST_USERS.map((user) => (
          <Cell key={user.telegramId} subtitle={t('login.noPassword')} onClick={() => loginAs(user)}>
            {user.firstName}
          </Cell>
        ))}
      </Section>
      {error && (
        <Section>
          <Cell>{error}</Cell>
        </Section>
      )}
    </List>
  )
}
