import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Sheet } from '../ui/Sheet'
import { useToast } from '../ui'
import { formatApiError } from '../../lib/api'
import { fetchFriends, fetchFriendsViewers, saveFriendsViewers, type FriendPerson } from '../../lib/friendsApi'

/**
 * "People I choose" for who sees your friends (section 32): a tick list of
 * your friends, since it is them the list is about and them you know.
 */
export function ChosenViewersSheet({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation()
  const toast = useToast()
  const [friends, setFriends] = useState<FriendPerson[] | null>(null)
  const [chosen, setChosen] = useState<Set<number>>(new Set())
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    fetchFriends().then(setFriends).catch(() => setFriends([]))
    fetchFriendsViewers().then((ids) => setChosen(new Set(ids))).catch(() => {})
  }, [])

  function toggle(id: number) {
    setChosen((before) => {
      const next = new Set(before)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function save() {
    setBusy(true)
    try {
      await saveFriendsViewers([...chosen])
      onClose()
    } catch (err) {
      toast.error(formatApiError(err))
      setBusy(false)
    }
  }

  return (
    <Sheet title={t('settings.chosenTitle')} onClose={onClose}>
      <p className="ui-field-help">{t('settings.chosenHint')}</p>
      {friends !== null && friends.length === 0 && <p className="ui-field-help">{t('settings.chosenEmpty')}</p>}
      <div className="ui-list">
        {(friends ?? []).map((person) => (
          <label key={person.user_id} className="ui-row st-choice">
            <input type="checkbox" checked={chosen.has(person.user_id)} onChange={() => toggle(person.user_id)} />
            <span className="ui-row-main"><span className="ui-row-title">{person.display_name}</span></span>
          </label>
        ))}
      </div>
      <button type="button" className="ui-btn ui-btn-primary ui-btn-lg ui-btn-block" disabled={busy} onClick={() => void save()}>
        {t('settings.chosenSave')}
      </button>
    </Sheet>
  )
}
