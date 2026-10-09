import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { useWorld } from '../../lib/worldApi'
import { TalkList } from './TalkList'

/**
 * On a computer, the conversations as a column beside the open one
 * (TECHNICAL_REQUIREMENTS.md section 43, the approved prototype: "in
 * conversations, two columns, like Telegram"). The same list as on the
 * phone — TalkList, with its tabs, archive and selection — only standing
 * in its own column instead of filling the screen.
 *
 * `current` marks the conversation that is open beside it.
 */
export function TalkColumn({ current }: { current: { conversationId?: number; userId?: number } }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const world = useWorld()
  return (
    <aside className="cos-talkcol" aria-label={t('bar.talk')}>
      <h1 className="cos-talkcol-title">{t('bar.talk')}</h1>
      <TalkList
        relations={world.relations}
        loaded={world.loaded}
        hasMore={world.hasMore}
        onNearEnd={world.loadMore}
        // Beside each other, moving between conversations replaces the one
        // open rather than piling them up behind the back button.
        onOpen={(relation) => navigate(`/conversations/with/${relation.userId}`, { replace: true })}
        onOpenSupport={(conversationId) => navigate(`/conversations/${conversationId}`, { replace: true })}
        onChanged={world.reload}
        current={current}
      />
    </aside>
  )
}

/** The conversations region with nobody chosen yet: its own sky and one
 *  quiet line, rather than an empty half of the screen. */
export function TalkNobodyYet() {
  const { t } = useTranslation()
  return (
    <div className="cos-talkcol-none">
      <p>{t('talkList.chooseOne')}</p>
    </div>
  )
}
