import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { EmojiGroup } from '../../lib/emojiSet'
import { Emoji } from '../../lib/emojiImage'
import { useHold } from '../../lib/useHold'

/**
 * The full list of emoji, for a reaction or for writing.
 *
 * Every emoji Microsoft's Fluent set draws, in Unicode's own order and
 * groups (lib/emojiSet.ts, built by scripts/build_emoji.py). The list is
 * fetched the first time this opens, and each picture only when it scrolls
 * into view, so opening the panel on a weak connection costs a screenful of
 * small files rather than the whole set.
 *
 * Holding an emoji that comes in skin tones opens its tones above it, the
 * way Telegram does; a plain tap takes the default.
 *
 * Until the list arrives a placeholder of the same size holds the space, so
 * the panel does not jump. If it cannot be fetched the panel says so and
 * offers to try again, rather than standing there empty.
 */
export function EmojiPanel({ onPick, className = '' }: { onPick: (emoji: string) => void; className?: string }) {
  const { t } = useTranslation()
  const [groups, setGroups] = useState<EmojiGroup[] | null>(null)
  const [tones, setTones] = useState<Record<string, string[]>>({})
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)
  /** The emoji whose tones are open, and where it sits. */
  const [toning, setToning] = useState<{ glyph: string; rect: DOMRect } | null>(null)

  useEffect(() => {
    let alive = true
    import('../../lib/emojiSet')
      .then((module) => {
        if (!alive) return
        setGroups(module.EMOJI_GROUPS)
        setTones(module.TONES)
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
              <EmojiButton
                key={emoji}
                emoji={emoji}
                toned={emoji in tones}
                onPick={onPick}
                onTones={(rect) => setToning({ glyph: emoji, rect })}
              />
            ))}
          </div>
        </section>
      ))}

      {toning && (
        <div className="cos-tone-scrim" onClick={() => setToning(null)} role="presentation">
          <div
            className="cos-tone-row"
            style={{
              top: Math.max(8, toning.rect.top - 56),
              left: Math.min(Math.max(8, toning.rect.left + toning.rect.width / 2 - 138), window.innerWidth - 284),
            }}
            onClick={(event) => event.stopPropagation()}
            role="listbox"
            aria-label={t('emoji.tones')}
          >
            {[toning.glyph, ...(tones[toning.glyph] ?? [])].map((version) => (
              <button
                key={version}
                type="button"
                className="cos-emoji"
                aria-label={version}
                onClick={() => {
                  setToning(null)
                  onPick(version)
                }}
              >
                <Emoji glyph={version} size={32} />
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function EmojiButton({
  emoji,
  toned,
  onPick,
  onTones,
}: {
  emoji: string
  toned: boolean
  onPick: (emoji: string) => void
  onTones: (rect: DOMRect) => void
}) {
  const hold = useHold({
    onTap: () => onPick(emoji),
    // A held emoji with no tones is simply chosen; nothing else could
    // have been meant.
    onHold: (target) => (toned ? onTones(target.getBoundingClientRect()) : onPick(emoji)),
    onSecondary: (target) => {
      if (toned) onTones(target.getBoundingClientRect())
    },
  })
  return (
    <button
      type="button"
      role="option"
      aria-selected={false}
      className={`cos-emoji${toned ? ' is-toned' : ''}`}
      aria-label={emoji}
      {...hold}
    >
      <Emoji glyph={emoji} size={32} />
    </button>
  )
}
