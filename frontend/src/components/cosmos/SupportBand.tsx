import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { fetchSupportStaff, handSupport, type SupportInfo } from '../../lib/conversationApi'

/**
 * Above the composer, for staff answering as Cosmos Team only
 * (TECHNICAL_REQUIREMENTS.md section 43): who is answering this person
 * right now, and a little about them — their language, when they joined,
 * what the team last told them — so the first answer does not have to be
 * "what is the problem?". The person on the other side never sees any of
 * it; to them it is simply "Cosmos Team".
 *
 * The owner also gets "hand to…", to give the conversation to one staff
 * member; a handed conversation stays theirs until they answer.
 */
export function SupportBand({
  conversationId,
  info,
  heldBy,
  onHanded,
}: {
  conversationId: number
  info: SupportInfo
  /** Somebody else answering right now (from the server or a refused claim). */
  heldBy: string | null
  onHanded: () => void
}) {
  const { t, i18n } = useTranslation()
  const [staff, setStaff] = useState<{ user_id: number; display_name: string }[]>([])
  const [handing, setHanding] = useState(false)

  function hand(to: number | null) {
    setHanding(false)
    void handSupport(conversationId, to).then(onHanded).catch(() => {})
  }

  useEffect(() => {
    if (info.can_hand) fetchSupportStaff().then(setStaff).catch(() => {})
  }, [info.can_hand])

  const facts = [
    info.language ? t('support.language', { language: languageName(info.language, i18n.language) }) : null,
    info.joined_at ? t('support.joined', { date: new Date(info.joined_at).toLocaleDateString(i18n.language) }) : null,
    info.last_notice ? t(`support.notice.${info.last_notice}`) : null,
  ].filter(Boolean)

  return (
    <div className="cos-support-band" role="note">
      {heldBy ? (
        <p className="cos-support-held" role="status">{t('support.heldBy', { name: heldBy })}</p>
      ) : info.held_by_me ? (
        <p className="cos-support-mine">{info.handed ? t('support.handedToYou') : t('support.yours')}</p>
      ) : null}
      {facts.length > 0 && <p className="cos-support-facts">{facts.join(' · ')}</p>}
      {info.can_hand && staff.length > 0 && (
        // The app's own menu, as everywhere else (the chat's three dots):
        // the browser's white list box looked like another program.
        <button type="button" className="cos-support-hand" aria-haspopup="menu" onClick={() => setHanding(true)}>
          {t('support.handTo')}
        </button>
      )}
      {handing && (
        <div className="cos-chatmenu-scrim" onClick={() => setHanding(false)} role="presentation">
          <div className="cos-chatmenu" role="menu" onClick={(event) => event.stopPropagation()}>
            {staff.map((person) => (
              <button
                key={person.user_id}
                type="button"
                role="menuitem"
                className="cos-chatmenu-item"
                onClick={() => hand(person.user_id)}
              >
                <span>{person.display_name}</span>
              </button>
            ))}
            <button type="button" role="menuitem" className="cos-chatmenu-item" onClick={() => hand(null)}>
              <span>{t('support.handFree')}</span>
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

/** "فارسی", "English"… in the reader's own language, or the code itself. */
function languageName(code: string, reader: string): string {
  try {
    return new Intl.DisplayNames([reader], { type: 'language' }).of(code) ?? code
  } catch {
    return code
  }
}
