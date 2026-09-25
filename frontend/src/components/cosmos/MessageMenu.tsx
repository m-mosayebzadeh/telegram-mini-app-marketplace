import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { reactionRow } from '../../lib/emoji'
import { EmojiPanel } from './EmojiPanel'
import { Emoji } from '../../lib/emojiImage'

export type MessageAction = 'reply' | 'copy' | 'edit' | 'delete'

interface MessageMenuProps {
  /** Where the message sits on screen, so the menu opens beside it. */
  anchor: DOMRect
  /** Your own messages sit on one side and theirs on the other; the menu
   *  lines up with the message rather than jumping to the middle. */
  mine: boolean
  actions: MessageAction[]
  /** Your current reaction, shown as chosen in the row. */
  chosen: string | null
  onReact: (emoji: string) => void
  onAction: (action: MessageAction) => void
  onClose: () => void
}

/** Room kept clear of the screen's edges, and between message and menu. */
const EDGE = 12
const GAP = 8

/**
 * What you can do with one message: react with one tap from the row on top,
 * or pick an action below it.
 *
 * It opens beside the message it belongs to, above or below depending on
 * where there is room, because a menu that appears somewhere else leaves
 * people unsure which message it is about. Everything else dims.
 *
 * Forward and pin are deliberately absent (TECHNICAL_REQUIREMENTS.md 29.13):
 * a stranger's private words should not be passed to a third person, and
 * pinning is little used between two people.
 */
export function MessageMenu({ anchor, mine, actions, chosen, onReact, onAction, onClose }: MessageMenuProps) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(false)
  const [top, setTop] = useState<number | null>(null)
  const boxRef = useRef<HTMLDivElement>(null)
  const row = reactionRow()

  // Placed after it is measured: below the message when it fits, above it
  // otherwise, and never off the screen.
  useLayoutEffect(() => {
    const box = boxRef.current
    if (!box) return
    const height = box.offsetHeight
    const room = window.innerHeight
    let place = anchor.bottom + GAP
    if (place + height > room - EDGE) place = anchor.top - GAP - height
    setTop(Math.max(EDGE, Math.min(place, room - EDGE - height)))
  }, [anchor, expanded])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const icons: Record<MessageAction, React.ReactNode> = {
    reply: <path d="M10 6 4 12l6 6M4 12h10a6 6 0 0 1 6 6" />,
    copy: (
      <>
        <rect x="8" y="8" width="11" height="12" rx="2.2" />
        <path d="M5 15.5V6.2C5 5 6 4 7.2 4h7.3" />
      </>
    ),
    edit: <path d="m14.5 5.5 4 4L8 20H4v-4L14.5 5.5Z" />,
    delete: <path d="M4.5 7h15M9.5 7V4.8h5V7M6.5 7l.9 12.2h9.2L17.5 7M10.2 10.5v5.5M13.8 10.5v5.5" />,
  }

  return (
    <div className="cos-menu-scrim" onClick={onClose} onContextMenu={(event) => event.preventDefault()} role="presentation">
      <div
        ref={boxRef}
        className={`cos-menu${mine ? ' is-mine' : ''}${expanded ? ' is-expanded' : ''}`}
        // Hidden for the one frame before it is measured, so it never
        // flashes in the wrong place.
        style={{ top: top ?? 0, visibility: top === null ? 'hidden' : 'visible' }}
        onClick={(event) => event.stopPropagation()}
        role="menu"
      >
        <div className="cos-menu-reactions">
          {row.map((emoji) => (
            <button
              key={emoji}
              type="button"
              className={`cos-menu-reaction${emoji === chosen ? ' is-chosen' : ''}`}
              onClick={() => onReact(emoji)}
              aria-label={emoji}
            >
              <Emoji glyph={emoji} size={28} />
            </button>
          ))}
          <button
            type="button"
            className="cos-menu-more"
            onClick={() => setExpanded((open) => !open)}
            aria-label={t('emoji.all')}
            aria-expanded={expanded}
          >
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
              <path d="m6 9.5 6 6 6-6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>

        {expanded ? (
          <EmojiPanel onPick={onReact} className="is-in-menu" />
        ) : (
          <div className="cos-menu-actions">
            {actions.map((action) => (
              <button
                key={action}
                type="button"
                role="menuitem"
                className={`cos-menu-action${action === 'delete' ? ' is-danger' : ''}`}
                onClick={() => onAction(action)}
              >
                <svg
                  viewBox="0 0 24 24"
                  width="20"
                  height="20"
                  aria-hidden="true"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  {icons[action]}
                </svg>
                {t(`talk.actions.${action}`)}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
