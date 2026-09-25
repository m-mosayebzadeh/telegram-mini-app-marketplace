import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { SpaceGround } from '../components/cosmos/SpaceGround'
import { ReportSheet } from '../components/cosmos/ReportSheet'
import { VoiceNote } from '../components/cosmos/VoiceNote'
import { MediaViewer } from '../components/chat/MediaViewer'
import { ApiError, formatApiError } from '../lib/api'
import { TYPING_SHOWN_MS, doneTyping, sayTyping, subscribe } from '../lib/live'
import {
  deliveryOf,
  laterOf,
  myReaction,
  newClientId,
  placeMessage,
  replaceMessage,
  tallyReactions,
  withoutMessages,
  withReactions,
  withWaiting,
  type Delivery,
  type ShownMessage,
} from '../lib/thread'
import { recordEmojiUse } from '../lib/emoji'
import { Emoji, EmojiText } from '../lib/emojiImage'
import { useHold } from '../lib/useHold'
import { MessageMenu, type MessageAction } from '../components/cosmos/MessageMenu'
import { DeleteDialog } from '../components/cosmos/DeleteDialog'
import { EmojiPanel } from '../components/cosmos/EmojiPanel'
import { useMe } from '../lib/MeContext'
import { canRecordVoice, startVoiceRecording, type VoiceSession } from '../lib/voiceRecorder'
import {
  deleteMessages,
  editMessage,
  fetchConversation,
  fetchMessageFile,
  fetchMessages,
  markRead,
  openConversationWith,
  sendPhoto,
  sendText,
  sendVoice,
  setReaction,
  type Conversation as Thread,
  type ConversationMessage,
} from '../lib/conversationApi'

/**
 * Talking to somebody.
 *
 * This is where "say hello" in the world leads, and where Echo hands you
 * over once it has found somebody. It is deliberately the quietest screen
 * in the product: the world is the identity and a conversation is a
 * utility, so restraint here is right where it would be wrong out there.
 * The sky is still behind it, unmoving, so that leaving the world does not
 * feel like leaving the application.
 *
 * What may be sent is whatever the SERVER says this thread allows right
 * now. Text, voice and photographs are free (section 24); video belongs to
 * a paid session. The composer reads the list instead of carrying its own
 * copy of the rule, so the two can never disagree.
 *
 * Live, without polling. The server pushes new messages and read receipts
 * down one shared connection (lib/live.ts); after a dropped connection the
 * screen asks again for everything, because nothing pushed is the only
 * copy.
 *
 * What you send appears at once with a clock beside it and goes when it
 * can. With no connection it waits, and is sent by itself when the
 * connection returns — in the order written — instead of failing and
 * making you type it again. One tick means the server has it, two mean
 * the other person has read that far.
 */

export default function Conversation() {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const { userId, id } = useParams()
  const { me } = useMe()

  const [thread, setThread] = useState<Thread | null>(null)
  const [messages, setMessages] = useState<ShownMessage[]>([])
  /** How far the other person has read, for the two ticks. */
  const [othersReadAt, setOthersReadAt] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [recording, setRecording] = useState<VoiceSession | null>(null)
  /** Seconds since recording began. A recording with no running clock
   *  feels like it might not be recording at all. */
  const [recordedFor, setRecordedFor] = useState(0)
  const [viewing, setViewing] = useState<string | null>(null)
  const [reporting, setReporting] = useState(false)
  const [reported, setReported] = useState(false)

  /** The message whose menu is open, and where it sits on screen. */
  const [menuFor, setMenuFor] = useState<{ message: ShownMessage; rect: DOMRect } | null>(null)
  /** Messages picked by holding one. Empty means not selecting. */
  const [selected, setSelected] = useState<Set<number>>(() => new Set())
  const [replyingTo, setReplyingTo] = useState<ShownMessage | null>(null)
  const [editing, setEditing] = useState<ShownMessage | null>(null)
  /** Messages waiting on the delete dialog's answer. */
  const [deleting, setDeleting] = useState<number[] | null>(null)
  const [emojiOpen, setEmojiOpen] = useState(false)
  /** A short confirmation, like "copied". */
  const [notice, setNotice] = useState<string | null>(null)
  /** Whether the other person is writing right now, from their "typing…"
   *  signals; it lapses on its own a few seconds after the last one. */
  const [theyType, setTheyType] = useState(false)
  const typingTimer = useRef<number | undefined>(undefined)
  const noticeTimer = useRef<number | undefined>(undefined)

  const endRef = useRef<HTMLDivElement>(null)
  const fieldRef = useRef<HTMLTextAreaElement>(null)
  const photoRef = useRef<HTMLInputElement>(null)

  /** What is waiting to be sent, oldest first, each with what it takes to
   *  send it again. A ref rather than state: it is worked through by a
   *  loop, not drawn — the clock-marked bubbles are what is drawn. */
  const outboxRef = useRef<{ clientId: string; send: () => Promise<ConversationMessage> }[]>([])
  const flushingRef = useRef(false)
  const retryRef = useRef<number | undefined>(undefined)
  const nextTempId = useRef(0)
  /** Local copies of photographs and voice notes sent from this screen,
   *  released when it closes. */
  const localUrls = useRef<string[]>([])

  useEffect(() => {
    // By person from the world, which opens the one thread two people
    // have; by thread from the chat list and Echo, which already know it.
    const open = userId ? openConversationWith(Number(userId)) : fetchConversation(Number(id))

    open
      .then(async (found) => {
        setThread(found)
        setOthersReadAt(found.others_read_at)
        setMessages(await fetchMessages(found.id))
        markRead(found.id).catch(() => {})
      })
      .catch((err) => setError(formatApiError(err)))
  }, [userId, id])

  useEffect(() => {
    if (!recording) return
    setRecordedFor(0)
    const started = Date.now()
    const tick = window.setInterval(() => setRecordedFor(Math.floor((Date.now() - started) / 1000)), 250)
    return () => window.clearInterval(tick)
  }, [recording])

  /** The box grows with what is written, up to a few lines, and then
   *  scrolls inside itself. Measured rather than fixed, because a message
   *  box that stays one line tall hides everything but the last line of
   *  what you are about to send. */
  useEffect(() => {
    const field = fieldRef.current
    if (!field) return
    field.style.height = 'auto'
    // scrollHeight is the text and the padding but not the border, and
    // the box is sized border-box — so without adding the border back the
    // box ends up two pixels short of its own text and grows a scrollbar
    // for those two pixels. That was the bar showing beside two lines.
    const border = field.offsetHeight - field.clientHeight
    const wanted = field.scrollHeight + border
    field.style.height = `${Math.min(wanted, MAX_FIELD_HEIGHT)}px`
    // Scrolling only once it has really reached its limit.
    field.style.overflowY = wanted > MAX_FIELD_HEIGHT ? 'auto' : 'hidden'
  }, [draft])

  /** A problem message fades on its own after a while. It said what it
   *  had to; staying on screen forever turns one failed attempt into a
   *  permanent verdict. */
  useEffect(() => {
    if (!error || !thread) return
    const clear = window.setTimeout(() => setError(null), 6000)
    return () => window.clearTimeout(clear)
  }, [error, thread])

  /** Always at the newest message. A conversation you have to scroll to
   *  the bottom of before you can read it is one you opened and
   *  immediately had to work on. */
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' })
  }, [messages.length])

  const can = (capability: string) => thread?.capabilities.includes(capability) ?? false

  /**
   * Works through what is waiting, one message at a time and in order.
   *
   * One at a time so that three messages written on a train arrive in the
   * order they were written, not in the order their uploads happened to
   * finish.
   */
  async function flush() {
    if (flushingRef.current) return
    flushingRef.current = true
    window.clearTimeout(retryRef.current)
    try {
      while (outboxRef.current.length > 0) {
        const next = outboxRef.current[0]
        try {
          const sent = await next.send()
          outboxRef.current.shift()
          setMessages((current) => placeMessage(current, sent))
          // Whatever went wrong before has plainly stopped going wrong. A
          // complaint left on screen after the thing it complains about
          // works again reads as the app being broken when it is not.
          setError(null)
        } catch (err) {
          if (err instanceof ApiError) {
            // The server answered, and the answer was no. Sending again
            // would get the same answer, so the message is taken back and
            // the reason shown.
            outboxRef.current.shift()
            setMessages((current) => current.filter((m) => m.client_id !== next.clientId))
            setError(formatApiError(err))
            continue
          }
          // No answer at all: offline, or the line dropped mid-send. The
          // message keeps its clock and goes when the connection returns
          // (the live connection's `ready`, or the browser's `online`) —
          // or at the latest on this timer, for a network that recovered
          // without either noticing.
          retryRef.current = window.setTimeout(() => void flush(), 8000)
          return
        }
      }
    } finally {
      flushingRef.current = false
    }
  }

  /** Shows a message at once, with a clock, and queues it to be sent. */
  function enqueue(
    shape: Pick<ShownMessage, 'type'> & Partial<ShownMessage>,
    send: (threadId: number, clientId: string) => Promise<ConversationMessage>,
  ) {
    if (!thread || !me) return
    const clientId = newClientId()
    nextTempId.current -= 1
    const waiting: ShownMessage = {
      id: nextTempId.current,
      conversation_id: thread.id,
      chat_session_id: null,
      sender_id: me.id,
      text: null,
      duration_seconds: null,
      created_at: new Date().toISOString(),
      flagged_payment: false,
      client_id: clientId,
      pending: true,
      ...shape,
    }
    setMessages((current) => placeMessage(current, waiting))
    const threadId = thread.id
    outboxRef.current.push({ clientId, send: () => send(threadId, clientId) })
    void flush()
  }

  function sendDraft() {
    const text = draft.trim()
    if (!text || !thread) return
    setDraft('')
    setEmojiOpen(false)
    doneTyping(thread.id)

    if (editing) {
      const target = editing
      setEditing(null)
      if (text === target.text) return
      // Shown at once; the server's answer (and the live event) confirm it.
      setMessages((current) =>
        replaceMessage(current, { ...target, text, edited_at: new Date().toISOString() }),
      )
      editMessage(thread.id, target.id, text)
        .then((saved) => setMessages((current) => replaceMessage(current, saved)))
        .catch((err) => {
          setMessages((current) => replaceMessage(current, target))
          setError(formatApiError(err))
        })
      return
    }

    const answering = replyingTo
    setReplyingTo(null)
    enqueue(
      {
        type: 'text',
        text,
        reply_to_id: answering?.id ?? null,
        reply_to: answering
          ? { id: answering.id, sender_id: answering.sender_id, type: answering.type, text: answering.text }
          : null,
      },
      (threadId, clientId) => sendText(threadId, text, clientId, answering?.id),
    )
  }

  /**
   * Whether a paid session's rule has closed this message to change
   * (TECHNICAL_REQUIREMENTS.md 24.1): read by the other side, or older
   * than a few minutes. The server decides for real; this only keeps the
   * app from offering what the server would refuse.
   */
  function lockedBySession(message: ShownMessage): boolean {
    if (message.chat_session_id == null) return false
    if (Date.now() - Date.parse(message.created_at) > PAID_GRACE_MS) return true
    return deliveryOf(message, othersReadAt) === 'seen'
  }

  const isMine = (message: ShownMessage) => message.sender_id === me?.id
  /** A person's name as the thread shows it. Your own name too, never
   *  "you" — the owner's choice, so a quote reads the same to both sides. */
  const nameOf = (userId: number) =>
    userId === me?.id
      ? (me?.display_name ?? '')
      : (thread?.others.find((person) => person.user_id === userId)?.display_name ?? '')
  const canEdit = (message: ShownMessage) =>
    isMine(message) && message.type === 'text' && !message.pending && !lockedBySession(message)

  /** The actions a message's menu offers, in Telegram's order. */
  function actionsFor(message: ShownMessage): MessageAction[] {
    const actions: MessageAction[] = []
    if (!message.pending) actions.push('reply')
    if (message.type === 'text') actions.push('copy')
    if (canEdit(message)) actions.push('edit')
    if (!message.pending) actions.push('delete')
    return actions
  }

  function flash(text: string) {
    setNotice(text)
    window.clearTimeout(noticeTimer.current)
    noticeTimer.current = window.setTimeout(() => setNotice(null), 1800)
  }

  async function copyMessages(ids: number[]) {
    const text = messages
      .filter((message) => ids.includes(message.id) && message.type === 'text')
      .map((message) => message.text)
      .join('\n\n')
    if (!text) return
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      // The clipboard API exists only on secure pages. The old way still
      // works everywhere else.
      const scratch = document.createElement('textarea')
      scratch.value = text
      document.body.appendChild(scratch)
      scratch.select()
      document.execCommand('copy')
      scratch.remove()
    }
    flash(t('talk.copied'))
  }

  function startEdit(message: ShownMessage) {
    setReplyingTo(null)
    setEditing(message)
    setDraft(message.text ?? '')
    fieldRef.current?.focus()
  }

  function startReply(message: ShownMessage) {
    setEditing(null)
    setReplyingTo(message)
    fieldRef.current?.focus()
  }

  /** Tapping the reaction you already gave takes it back, as in Telegram. */
  function react(message: ShownMessage, emoji: string) {
    if (!thread || !me) return
    const next = myReaction(message, me.id) === emoji ? null : emoji
    if (next) recordEmojiUse(next)
    const others = (message.reactions ?? []).filter((reaction) => reaction.user_id !== me.id)
    const reactions = next ? [...others, { user_id: me.id, emoji: next }] : others
    setMessages((current) => withReactions(current, message.id, reactions))
    setReaction(thread.id, message.id, next).catch((err) => {
      setMessages((current) => withReactions(current, message.id, message.reactions ?? []))
      setError(formatApiError(err))
    })
  }

  function confirmDelete(forEveryone: boolean) {
    const ids = deleting ?? []
    setDeleting(null)
    setSelected(new Set())
    if (!thread || ids.length === 0) return
    const before = messages
    setMessages((current) => withoutMessages(current, ids))
    deleteMessages(thread.id, ids, forEveryone).catch((err) => {
      setMessages(before)
      setError(formatApiError(err))
    })
  }

  function toggleSelected(message: ShownMessage) {
    if (message.pending) return
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(message.id)) next.delete(message.id)
      else next.add(message.id)
      return next
    })
  }

  function openMenu(message: ShownMessage, row: HTMLElement) {
    const bubble = row.querySelector('.cos-bubble') ?? row
    setMenuFor({ message, rect: bubble.getBoundingClientRect() })
  }

  /** Jumps to the message a reply quotes, and marks it for a moment so the
   *  eye finds it. */
  function showOriginal(id: number) {
    const row = document.getElementById(`message-${id}`)
    if (!row) return
    row.scrollIntoView({ block: 'center', behavior: 'smooth' })
    row.classList.add('is-found')
    window.setTimeout(() => row.classList.remove('is-found'), 1400)
  }

  const selectedMessages = messages.filter((message) => selected.has(message.id))
  const selecting = selected.size > 0

  /** The live connection: their messages as they are written, and how far
   *  they have read. */
  useEffect(() => {
    if (!thread) return
    const threadId = thread.id
    return subscribe((event) => {
      if (event.type === 'ready') {
        if (event.resumed) {
          // Anything could have happened while the line was down.
          Promise.all([fetchMessages(threadId), fetchConversation(threadId)])
            .then(([fresh, found]) => {
              setMessages((current) => withWaiting(fresh, current))
              setOthersReadAt((current) => laterOf(current, found.others_read_at))
              // What arrived while the line was down has now been seen, if
              // the screen is in front of somebody; without this their
              // messages stayed at one tick after the reconnect.
              if (document.visibilityState === 'visible') markRead(threadId).catch(() => {})
            })
            .catch(() => {})
        }
        void flush()
        return
      }
      if (event.conversation_id !== threadId) return
      if (event.type === 'typing') {
        if (event.user_id === me?.id) return
        setTheyType(true)
        window.clearTimeout(typingTimer.current)
        typingTimer.current = window.setTimeout(() => setTheyType(false), TYPING_SHOWN_MS)
        return
      }
      if (event.type === 'message') {
        // Their message has arrived, so whatever they were typing is done.
        if (event.message.sender_id !== me?.id) {
          window.clearTimeout(typingTimer.current)
          setTheyType(false)
        }
        setMessages((current) => placeMessage(current, event.message))
        // Counted as read only if it could have been: a phone in a pocket
        // with the app in the background has read nothing.
        if (event.message.sender_id !== me?.id && document.visibilityState === 'visible') {
          markRead(threadId).catch(() => {})
        }
      } else if (event.type === 'read') {
        setOthersReadAt((current) => laterOf(current, event.read_at))
      } else if (event.type === 'edited') {
        setMessages((current) => replaceMessage(current, event.message))
      } else if (event.type === 'deleted') {
        setMessages((current) => withoutMessages(current, event.message_ids))
        // A message that just vanished cannot stay selected or quoted.
        setSelected((current) => {
          const next = new Set(current)
          for (const gone of event.message_ids) next.delete(gone)
          return next
        })
      } else if (event.type === 'reactions') {
        setMessages((current) => withReactions(current, event.message_id, event.reactions))
      }
    })
    // flush reads only refs, so it need not be a dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [thread?.id, me?.id])

  /** Coming back to the app counts as reading what arrived meanwhile, and
   *  the network returning is a reason to try the waiting messages now. */
  useEffect(() => {
    if (!thread) return
    const threadId = thread.id
    const onVisible = () => {
      if (document.visibilityState === 'visible') markRead(threadId).catch(() => {})
    }
    const onOnline = () => void flush()
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('online', onOnline)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('online', onOnline)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [thread?.id])

  useEffect(() => {
    const urls = localUrls.current
    return () => {
      window.clearTimeout(retryRef.current)
      window.clearTimeout(typingTimer.current)
      for (const url of urls) URL.revokeObjectURL(url)
    }
  }, [])

  async function toggleRecording() {
    if (!thread) return
    if (recording) {
      const result = await recording.stop()
      setRecording(null)
      if (result) {
        // The recording's own local copy plays in the bubble until the
        // server has it, so a voice note sent offline can still be heard.
        localUrls.current.push(result.url)
        enqueue(
          { type: 'voice', duration_seconds: result.durationSeconds, localUrl: result.url },
          (threadId, clientId) => sendVoice(threadId, result.file, result.durationSeconds, clientId),
        )
      }
      return
    }
    if (!canRecordVoice()) {
      // Said rather than hidden. A missing microphone button looks like a
      // missing feature; a clear sentence says what to do about it. The
      // usual cause is a page opened over plain http, where browsers do
      // not offer a microphone at all.
      setError(t('talk.microphoneUnavailable'))
      return
    }
    try {
      setRecording(await startVoiceRecording())
      setError(null)
    } catch {
      // Permission refused. Said out loud, because a microphone button that
      // silently does nothing reads as a broken app, not a refused one.
      setError(t('talk.noMicrophone'))
    }
  }

  function pickPhoto(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file || !thread) return
    const localUrl = URL.createObjectURL(file)
    localUrls.current.push(localUrl)
    enqueue({ type: 'photo', localUrl }, (threadId, clientId) => sendPhoto(threadId, file, clientId))
  }

  const other = thread?.others[0]

  /**
   * The warning goes under the FIRST message that carried a payment
   * detail, and only that one.
   *
   * Once per conversation rather than under every such message: a warning
   * that repeats stops being read, and the second one is what teaches
   * people to ignore the first. Both people see it, because the person
   * being asked to pay is usually the one who gets hurt.
   */
  const firstFlagged = messages.find((message) => message.flagged_payment)?.id

  if (error && !thread) {
    return (
      <div className="cos-screen cos-centre">
        <SpaceGround />
        <p className="cos-message">{error}</p>
      </div>
    )
  }

  return (
    <div className="cos-screen cos-talk">
      <SpaceGround />

      {selecting && (
        // Takes the header's place while selecting: what is picked, and what
        // can be done with all of it at once. Edit only for a single message
        // of your own; copy only when everything picked is text.
        <header className="cos-talk-head cos-select-bar">
          <button className="cos-talk-back" onClick={() => setSelected(new Set())} aria-label={t('common.cancel')}>
            <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
              <path d="M6 6l12 12M18 6 6 18" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
            </svg>
          </button>
          <span className="cos-select-count">{t('talk.selected', { count: selected.size })}</span>
          <span className="cos-select-actions">
            {selectedMessages.length === 1 && canEdit(selectedMessages[0]) && (
              <button
                className="cos-talk-tool"
                aria-label={t('talk.actions.edit')}
                onClick={() => {
                  startEdit(selectedMessages[0])
                  setSelected(new Set())
                }}
              >
                <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round">
                  <path d="m14.5 5.5 4 4L8 20H4v-4L14.5 5.5Z" />
                </svg>
              </button>
            )}
            {selectedMessages.every((message) => message.type === 'text') && (
              <button
                className="cos-talk-tool"
                aria-label={t('talk.actions.copy')}
                onClick={() => {
                  void copyMessages([...selected])
                  setSelected(new Set())
                }}
              >
                <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="8" y="8" width="11" height="12" rx="2.2" />
                  <path d="M5 15.5V6.2C5 5 6 4 7.2 4h7.3" />
                </svg>
              </button>
            )}
            <button className="cos-talk-tool is-danger" aria-label={t('talk.actions.delete')} onClick={() => setDeleting([...selected])}>
              <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4.5 7h15M9.5 7V4.8h5V7M6.5 7l.9 12.2h9.2L17.5 7M10.2 10.5v5.5M13.8 10.5v5.5" />
              </svg>
            </button>
          </span>
        </header>
      )}

      <header className="cos-talk-head" hidden={selecting}>
        <button className="cos-talk-back" onClick={() => navigate(-1)} aria-label={t('talk.back')}>
          <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
            <path
              d="M15 5 8 12l7 7"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
        <span className="cos-talk-who">
          {other?.display_name ?? ''}
          {/* Under the name, where Telegram puts it, and quiet: the header
              is orientation, and this is a detail of it. */}
          {theyType && <span className="cos-talk-typing">{t('talk.typing')}</span>}
        </span>
      </header>

      <div className="cos-talk-thread">
        {thread && messages.length === 0 && (
          <p className="cos-talk-empty">{t('talk.nothingYet', { name: other?.display_name ?? '' })}</p>
        )}

        {messages.map((message) => (
          // Keyed by the phone's own name where there is one, so a bubble
          // does not rebuild itself (and reload its photo) at the moment
          // its clock turns into a tick.
          <MessageRow
            key={message.client_id ?? message.id}
            id={message.pending ? undefined : `message-${message.id}`}
            mine={isMine(message)}
            selecting={selecting}
            selected={selected.has(message.id)}
            onTap={(row) => (selecting ? toggleSelected(message) : openMenu(message, row))}
            onHold={() => toggleSelected(message)}
          >
            <div className={`cos-bubble${isMine(message) ? ' is-mine' : ''}`}>
              {message.reply_to && (
                <button
                  className="cos-bubble-quote"
                  onClick={() => showOriginal(message.reply_to!.id)}
                  data-control
                >
                  <span className="cos-bubble-quote-who">
                    {nameOf(message.reply_to.sender_id)}
                  </span>
                  <span className="cos-bubble-quote-text">
                    {message.reply_to.type === 'text' ? (
                      <EmojiText text={message.reply_to.text ?? ''} size={16} />
                    ) : (
                      t(`talk.kinds.${message.reply_to.type}`)
                    )}
                  </span>
                </button>
              )}

              {message.type === 'text' && message.text && <EmojiText text={message.text} />}

              {message.type === 'photo' && thread && (
                <MessagePhoto
                  conversationId={thread.id}
                  messageId={message.id}
                  localUrl={message.localUrl}
                  onOpen={selecting ? () => {} : setViewing}
                />
              )}

              {message.type === 'voice' && thread && (
                <MessageVoice
                  conversationId={thread.id}
                  messageId={message.id}
                  durationSeconds={message.duration_seconds}
                  localUrl={message.localUrl}
                  mine={message.sender_id === me?.id}
                />
              )}

              <span className="cos-bubble-time">
                {message.edited_at && <span className="cos-bubble-edited">{t('talk.edited')}</span>}
                {new Date(message.created_at).toLocaleTimeString(i18n.language, {
                  hour: '2-digit',
                  minute: '2-digit',
                })}
                {message.sender_id === me?.id && <Ticks delivery={deliveryOf(message, othersReadAt)} />}
              </span>
            </div>

            {(message.reactions?.length ?? 0) > 0 && (
              <div className={`cos-reactions${isMine(message) ? ' is-mine' : ''}`}>
                {tallyReactions(message.reactions, me?.id).map((reaction) => (
                  <button
                    key={reaction.emoji}
                    className={`cos-reaction${reaction.mine ? ' is-mine' : ''}`}
                    onClick={() => react(message, reaction.emoji)}
                    aria-pressed={reaction.mine}
                    data-control
                  >
                    <Emoji glyph={reaction.emoji} size={20} />
                    {reaction.count > 1 && <span className="cos-reaction-count">{reaction.count.toLocaleString(i18n.language)}</span>}
                  </button>
                ))}
              </div>
            )}

            {message.id === firstFlagged && (
              <PaymentWarning
                reported={reported}
                // Reporting yourself is not possible, and the warning under
                // your own card number is for you, not about you.
                canReport={message.sender_id !== me?.id}
                onReport={() => setReporting(true)}
              />
            )}
          </MessageRow>
        ))}
        <div ref={endRef} />
      </div>

      {error && thread && <p className="cos-talk-error">{error}</p>}
      {notice && (
        <p className="cos-talk-notice" role="status">
          {notice}
        </p>
      )}

      {(replyingTo || editing) && (
        // What the next send will do, above the box, with a way out. Without
        // it a reply looks like an ordinary message until it is too late.
        <div className="cos-talk-context">
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            {editing ? <path d="m14.5 5.5 4 4L8 20H4v-4L14.5 5.5Z" /> : <path d="M10 6 4 12l6 6M4 12h10a6 6 0 0 1 6 6" />}
          </svg>
          <span className="cos-talk-context-body">
            <span className="cos-talk-context-title">
              {editing
                ? t('talk.editing')
                : t('talk.replyingTo', {
                    name: nameOf(replyingTo!.sender_id),
                  })}
            </span>
            <span className="cos-talk-context-text">
              {(editing ?? replyingTo)!.type === 'text'
                ? (editing ?? replyingTo)!.text
                : t(`talk.kinds.${(editing ?? replyingTo)!.type}`)}
            </span>
          </span>
          <button
            className="cos-talk-tool"
            aria-label={t('common.cancel')}
            onClick={() => {
              if (editing) setDraft('')
              setEditing(null)
              setReplyingTo(null)
            }}
          >
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
              <path d="M6 6l12 12M18 6 6 18" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      )}

      {emojiOpen && (
        <EmojiPanel
          className="is-docked"
          onPick={(emoji) => {
            // Into the text where the cursor is, not always at the end.
            const field = fieldRef.current
            const at = field?.selectionStart ?? draft.length
            const until = field?.selectionEnd ?? at
            setDraft(draft.slice(0, at) + emoji + draft.slice(until))
            requestAnimationFrame(() => {
              field?.focus()
              field?.setSelectionRange(at + emoji.length, at + emoji.length)
            })
          }}
        />
      )}

      <div className="cos-talk-say">
        {!recording && (
          <button
            className={`cos-talk-tool${emojiOpen ? ' is-on' : ''}`}
            onClick={() => setEmojiOpen((open) => !open)}
            aria-label={t('emoji.all')}
            aria-expanded={emojiOpen}
          >
            <svg viewBox="0 0 24 24" width="23" height="23" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
              <circle cx="12" cy="12" r="8.5" />
              <path d="M8.6 14.2a4.2 4.2 0 0 0 6.8 0" />
              <path d="M9.3 9.6v.2M14.7 9.6v.2" strokeWidth="2" />
            </svg>
          </button>
        )}
        {can('photo') && !recording && !editing && (
          <>
            <button
              className="cos-talk-tool"
              onClick={() => photoRef.current?.click()}
              aria-label={t('talk.photo')}
            >
              {/* A paperclip, because that is the mark every messenger
                  uses for "add something" and a picture frame reads as
                  "your gallery" instead. */}
              <svg viewBox="0 0 24 24" width="23" height="23" aria-hidden="true">
                <path
                  d="M20 11.3 12.1 19.2a5 5 0 0 1-7.1-7.1l8.2-8.2a3.4 3.4 0 0 1 4.8 4.8l-8.2 8.2a1.7 1.7 0 0 1-2.4-2.4l7.4-7.4"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
            <input ref={photoRef} type="file" accept="image/*" hidden onChange={pickPhoto} />
          </>
        )}

        {recording ? (
          <div className="cos-talk-recording">
            <span className="cos-talk-rec-dot" aria-hidden="true" />
            <span className="cos-talk-rec-clock">
              {Math.floor(recordedFor / 60).toLocaleString(i18n.language)}:
              {(recordedFor % 60).toLocaleString(i18n.language, { minimumIntegerDigits: 2 })}
            </span>
            {t('talk.recording')}
            <button
              className="cos-talk-rec-cancel"
              onClick={() => {
                recording.cancel()
                setRecording(null)
              }}
            >
              {t('talk.cancel')}
            </button>
          </div>
        ) : (
          // On a computer, Enter sends and Shift+Enter starts a new line.
          // On a phone, Enter starts a new line and the button sends: a
          // phone keyboard has no Shift+Enter, so sending on Enter there
          // would leave no way at all to write a second line. Telegram
          // does exactly this, for exactly that reason.
          <textarea
            ref={fieldRef}
            className="cos-talk-field"
            rows={1}
            value={draft}
            onChange={(event) => {
              setDraft(event.target.value)
              // Editing an old message is not "typing" to the other side.
              if (thread && !editing && event.target.value.trim()) sayTyping(thread.id)
            }}
            onKeyDown={(event) => {
              // Mid-way through composing a character in an input method
              // (Persian on some keyboards, Chinese, Japanese) Enter
              // confirms the character. Sending there would send half a
              // word.
              if (event.nativeEvent.isComposing) return
              if (event.key === 'Enter' && !event.shiftKey && hasPhysicalKeyboard()) {
                event.preventDefault()
                sendDraft()
              }
            }}
            placeholder={t('talk.placeholder')}
            aria-label={t('talk.placeholder')}
          />
        )}

        {/* One button, three jobs: send what is written, start a voice
            note when nothing is, and finish one that is being recorded.
            Two buttons side by side would be two places for a thumb to be
            wrong about. */}
        {draft.trim() || !can('voice') ? (
          <button
            className="cos-talk-send"
            onClick={sendDraft}
            disabled={!draft.trim()}
            aria-label={t('talk.send')}
          >
            <SendIcon />
          </button>
        ) : (
          <button
            className={`cos-talk-send${recording ? ' is-recording' : ''}`}
            onClick={toggleRecording}
            aria-label={recording ? t('talk.send') : t('talk.voice')}
          >
            {recording ? <SendIcon /> : <MicIcon />}
          </button>
        )}
      </div>

      {viewing && <MediaViewer url={viewing} kind="photo" onClose={() => setViewing(null)} />}

      {menuFor && (
        <MessageMenu
          anchor={menuFor.rect}
          mine={isMine(menuFor.message)}
          actions={actionsFor(menuFor.message)}
          chosen={myReaction(menuFor.message, me?.id)}
          onClose={() => setMenuFor(null)}
          onReact={(emoji) => {
            if (!menuFor.message.pending) react(menuFor.message, emoji)
            setMenuFor(null)
          }}
          onAction={(action) => {
            const message = menuFor.message
            setMenuFor(null)
            if (action === 'reply') startReply(message)
            else if (action === 'copy') void copyMessages([message.id])
            else if (action === 'edit') startEdit(message)
            else setDeleting([message.id])
          }}
        />
      )}

      {deleting && (
        <DeleteDialog
          count={deleting.length}
          // "Also for Sara" only when every message is yours and still
          // open; anybody else's can only ever leave your own view.
          alsoFor={
            messages
              .filter((message) => deleting.includes(message.id))
              .every((message) => isMine(message) && !lockedBySession(message))
              ? (other?.display_name ?? null)
              : null
          }
          onCancel={() => setDeleting(null)}
          onConfirm={confirmDelete}
        />
      )}

      {reporting && other && (
        <ReportSheet
          reportedUserId={other.user_id}
          name={other.display_name}
          conversationId={thread?.id}
          initialReason="off_app_payment"
          onClose={() => setReporting(false)}
          onSent={() => {
            setReporting(false)
            setReported(true)
          }}
        />
      )}
    </div>
  )
}

/**
 * The line under a card number.
 *
 * Written to protect, not to accuse: two friends settling a bill are doing
 * nothing wrong, so it says what the app can and cannot do rather than
 * what the other person might be. And it is the one place a report is a
 * single tap away, with the right reason already chosen, because somebody
 * pressing for payment outside the app is exactly who should be reported.
 */
function PaymentWarning({
  canReport,
  reported,
  onReport,
}: {
  canReport: boolean
  reported: boolean
  onReport: () => void
}) {
  const { t } = useTranslation()
  return (
    <div className="cos-talk-warning" role="note">
      <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" className="cos-talk-warning-mark">
        <path
          d="M12 3.5 19.5 6v5.5c0 4.4-3.1 7.9-7.5 9-4.4-1.1-7.5-4.6-7.5-9V6L12 3.5Z"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
        <path d="M12 8.5v4.2M12 15.6v.1" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      </svg>
      <p className="cos-talk-warning-text">{t('talk.paymentWarning')}</p>
      {canReport &&
        (reported ? (
          <span className="cos-talk-warning-done">{t('talk.reported')}</span>
        ) : (
          <button className="cos-talk-warning-report" onClick={onReport}>
            {t('talk.report')}
          </button>
        ))}
    </div>
  )
}

/** Fetches a file behind authentication and hands back a local address,
 *  released again when the message leaves the screen. */
function useMessageFile(conversationId: number, messageId: number | null): string | null {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    // Nothing to fetch: this phone already holds its own copy.
    if (messageId === null) return
    let alive = true
    let made: string | null = null
    fetchMessageFile(conversationId, messageId)
      .then((address) => {
        made = address
        if (alive) setUrl(address)
        else URL.revokeObjectURL(address)
      })
      .catch(() => {})
    return () => {
      alive = false
      if (made) URL.revokeObjectURL(made)
    }
  }, [conversationId, messageId])
  return url
}

function MessagePhoto({
  conversationId,
  messageId,
  localUrl,
  onOpen,
}: {
  conversationId: number
  messageId: number
  localUrl?: string
  onOpen: (url: string) => void
}) {
  const fetched = useMessageFile(conversationId, localUrl ? null : messageId)
  const url = localUrl ?? fetched
  const { t } = useTranslation()
  return (
    <button className="cos-bubble-photo" onClick={() => url && onOpen(url)} aria-label={t('talk.openPhoto')}>
      {url ? <img src={url} alt="" /> : <span className="cos-bubble-photo-wait" />}
    </button>
  )
}

function MessageVoice({
  conversationId,
  messageId,
  durationSeconds,
  localUrl,
  mine,
}: {
  conversationId: number
  messageId: number
  durationSeconds: number | null
  localUrl?: string
  mine: boolean
}) {
  const fetched = useMessageFile(conversationId, localUrl ? null : messageId)
  const url = localUrl ?? fetched
  return <VoiceNote src={url} durationSeconds={durationSeconds} mine={mine} />
}

/**
 * Where one of your own messages has got to.
 *
 * A clock while it is on its way, one tick once the server has it, two
 * once the other person has read it. The second pair takes Sol's warmth,
 * never green: green in this product means "here right now" and nothing
 * else, and a green tick would leave somebody unsure which one they are
 * looking at.
 */
function Ticks({ delivery }: { delivery: Delivery }) {
  const { t } = useTranslation()
  if (delivery === 'sending') {
    return (
      <svg className="cos-tick is-sending" viewBox="0 0 16 16" width="13" height="13" role="img" aria-label={t('talk.sending')}>
        <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeWidth="1.3" />
        <path className="cos-tick-hand" d="M8 8V4.6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
        <path d="M8 8h2.4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      </svg>
    )
  }
  return (
    <svg
      className={`cos-tick is-${delivery}`}
      viewBox="0 0 20 16"
      width="17"
      height="13"
      role="img"
      aria-label={delivery === 'seen' ? t('talk.seen') : t('talk.sent')}
    >
      <path d="M2.5 8.6 5.8 12 12.5 4.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      {delivery === 'seen' && (
        <path d="M9.4 11.2 10.2 12 16.9 4.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      )}
    </svg>
  )
}

function SendIcon() {
  return (
    <svg viewBox="0 0 24 24" width="21" height="21" aria-hidden="true">
      <path
        d="M4 12h14M12 5l7 7-7 7"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function MicIcon() {
  return (
    <svg viewBox="0 0 24 24" width="21" height="21" aria-hidden="true">
      <rect x="9" y="3.5" width="6" height="11" rx="3" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v2.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  )
}

/** How long a message written in a paid session stays open to change,
 *  matching the server's PAID_GRACE (app/chat_message/actions.py). */
const PAID_GRACE_MS = 3 * 60 * 1000

/**
 * One message's row: a tap opens its menu (or, while selecting, picks it),
 * a hold starts selecting with it.
 *
 * Taps on the controls inside a bubble — play, a photo, a quote, a reaction
 * — belong to those controls and are left alone. Holding one still selects
 * the message, since that is what a held finger means anywhere on it.
 */
function MessageRow({
  id,
  mine,
  selecting,
  selected,
  onTap,
  onHold,
  children,
}: {
  id?: string
  mine: boolean
  selecting: boolean
  selected: boolean
  onTap: (row: HTMLElement) => void
  onHold: () => void
  children: React.ReactNode
}) {
  const rowRef = useRef<HTMLDivElement>(null)
  const hold = useHold({
    onTap: (target, pointerType) => {
      if (!selecting) {
        if (target.closest('button, [role="slider"], audio, [data-control]')) return
        // On a computer a left click does nothing, so it stays free for
        // selecting a piece of the text to copy; the right button opens
        // the menu, as in Telegram on the desktop (the owner's decision).
        // While selecting, a click still picks messages.
        if (pointerType === 'mouse') return
      }
      if (rowRef.current) onTap(rowRef.current)
    },
    onHold,
    onSecondary: () => rowRef.current && onTap(rowRef.current),
  })
  return (
    <div
      ref={rowRef}
      id={id}
      className={`cos-talk-row${mine ? ' is-mine' : ''}${selecting ? ' is-selecting' : ''}${selected ? ' is-selected' : ''}`}
      aria-selected={selecting ? selected : undefined}
      {...hold}
    >
      {selecting && <span className="cos-select-mark" aria-hidden="true" />}
      {children}
    </div>
  )
}

/** The tallest the writing box grows before it scrolls inside itself. */
const MAX_FIELD_HEIGHT = 132

/**
 * Whether the person is typing on a real keyboard rather than a phone's.
 *
 * Asked of the POINTER, not the screen size: a precise pointer that can
 * hover means a mouse or trackpad, which comes with a keyboard that has
 * Shift. A phone reports a coarse pointer that cannot hover. A tablet with
 * a keyboard attached reports the fine pointer too, which is the right
 * answer — it has Shift+Enter.
 */
function hasPhysicalKeyboard(): boolean {
  return typeof window.matchMedia === 'function'
    ? window.matchMedia('(hover: hover) and (pointer: fine)').matches
    : true
}
