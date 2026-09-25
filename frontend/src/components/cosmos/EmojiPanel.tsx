import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { EmojiGroup } from '../../lib/emojiSet'

/**
 * The full list of emoji, for a reaction or for writing.
 *
 * The list itself is fetched the first time this opens (lib/emojiSet.ts)
 * and kept after that by the browser like any other file. Until it
 * arrives, a quiet placeholder of the same size holds the space, so the
 * panel does not jump when it fills. If it cannot be fetched — a weak
 * connection — the panel says so and offers to try again, rather than
 * standing there empty, which is what it once did on a phone.
 */
export function EmojiPanel({ onPick, className = '' }: { onPick: (emoji: string) => void; className?: string }) {
  const { t } = useTranslation()
  const [groups, setGroups] = useState<EmojiGroup[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let alive = true
    import('../../lib/emojiSet')
      .then((module) => {
        if (alive) setGroups(module.EMOJI_GROUPS)
      })
      .catch(() => {
        if (alive) setFailed(true)
      })
    return () => {
      alive = false
    }
  }, [attempt])

  return (
    <div className={`cos-emoji-panel ${className}`} role="listbox" aria-label={t('emoji.all')}>
      {!groups && !failed && <div className="cos-emoji-wait" aria-hidden="true" />}
      {failed && (
        <div className="cos-emoji-wait cos-emoji-failed">
          <button
            type="button"
            className="cos-emoji-retry"
            onClick={() => {
              setFailed(false)
              setAttempt((n) => n + 1)
            }}
          >
            {t('emoji.retry')}
          </button>
        </div>
      )}
      {groups?.map((group) => (
        <section key={group.key} className="cos-emoji-group">
          <h3 className="cos-emoji-heading">{t(`emoji.groups.${group.key}`)}</h3>
          <div className="cos-emoji-grid">
            {group.emoji.map((emoji) => (
              <button
                key={emoji}
                type="button"
                role="option"
                aria-selected={false}
                className="cos-emoji"
                onClick={() => onPick(emoji)}
              >
                {emoji}
              </button>
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}
