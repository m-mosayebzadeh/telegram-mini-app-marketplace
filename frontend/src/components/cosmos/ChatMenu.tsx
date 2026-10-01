import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { ClearIcon } from './TalkList'

/**
 * The menu behind the three dots at the top of a chat (section 32): the
 * four things the owner picked from Telegram's — mute, search, clear the
 * history, delete the chat. Mute is one switch whose word and icon change
 * with it, as in Telegram ("Mute" becomes "Unmute"), with nothing more
 * elaborate behind it.
 */

export type ChatMenuAction = 'mute' | 'search' | 'clear' | 'delete'

interface Props {
  muted: boolean
  onChoose: (action: ChatMenuAction) => void
  onClose: () => void
}

function Icon({ action, muted }: { action: ChatMenuAction; muted: boolean }) {
  const common = { viewBox: '0 0 24 24', width: 20, height: 20, 'aria-hidden': true, fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }
  switch (action) {
    case 'mute':
      // What pressing it will do: a speaker with sound for "unmute", a
      // crossed-out one for "mute".
      return muted ? (
        <svg {...common}><path d="M11 5 6.5 9H3.5v6h3L11 19V5Z" /><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11" /></svg>
      ) : (
        <svg {...common}><path d="M11 5 6.5 9H3.5v6h3L11 19V5Z" /><path d="m15.5 9.5 5 5m0-5-5 5" /></svg>
      )
    case 'search':
      return <svg {...common}><circle cx="10.5" cy="10.5" r="6" /><path d="m15 15 5 5" /></svg>
    case 'clear':
      return <ClearIcon />
    case 'delete':
      return <svg {...common}><path d="M4.5 7h15M9.5 7V4.8h5V7M6.5 7l.9 12.2h9.2L17.5 7M10.2 10.5v5.5M13.8 10.5v5.5" /></svg>
  }
}

export function ChatMenu({ muted, onChoose, onClose }: Props) {
  const { t } = useTranslation()
  const first = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    first.current?.focus()
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const items: Array<{ action: ChatMenuAction; label: string; danger?: boolean }> = [
    { action: 'mute', label: muted ? t('talk.menu.unmute') : t('talk.menu.mute') },
    { action: 'search', label: t('talk.menu.search') },
    { action: 'clear', label: t('talk.menu.clear') },
    { action: 'delete', label: t('talk.menu.delete'), danger: true },
  ]

  return (
    <div className="cos-chatmenu-scrim" onClick={onClose} role="presentation">
      <div className="cos-chatmenu" role="menu" aria-label={t('talk.menu.label')} onClick={(event) => event.stopPropagation()}>
        {items.map((item, index) => (
          <button
            key={item.action}
            ref={index === 0 ? first : undefined}
            type="button"
            role="menuitem"
            className={`cos-chatmenu-item${item.danger ? ' is-danger' : ''}`}
            onClick={() => onChoose(item.action)}
          >
            <Icon action={item.action} muted={muted} />
            <span>{item.label}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
