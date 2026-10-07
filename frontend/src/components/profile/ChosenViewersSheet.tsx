import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CosSheet } from '../cosmos/CosSheet'
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
    <CosSheet title={t('settings.chosenTitle')} onClose={onClose}>
      <div className="cos-q-sheet-body">
        <p className="cos-q-help">{t('settings.chosenHint')}</p>
        {friends !== null && friends.length === 0 && <p className="cos-q-help">{t('settings.chosenEmpty')}</p>}
        <div className="cos-q-choice">
          {(friends ?? []).map((person) => (
            <label key={person.user_id}>
              <input type="checkbox" checked={chosen.has(person.user_id)} onChange={() => toggle(person.user_id)} />
              {person.display_name}
            </label>
          ))}
        </div>
        <button type="button" className="cos-q-primary" disabled={busy} onClick={() => void save()}>
          {t('settings.chosenSave')}
        </button>
      </div>
    </CosSheet>
  )
}
