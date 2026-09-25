import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { SpaceGround } from '../components/cosmos/SpaceGround'
import { ReportSheet } from '../components/cosmos/ReportSheet'
import { VoiceNote } from '../components/cosmos/VoiceNote'
import { MediaViewer } from '../components/chat/MediaViewer'
import { ApiError, formatApiError } from '../lib/api'
import { subscribe } from '../lib/live'
import {
  deliveryOf,
  laterOf,
  newClientId,
  placeMessage,
  withWaiting,
  type Delivery,
  type ShownMessage,
} from '../lib/thread'
import { useMe } from '../lib/MeContext'
import { canRecordVoice, startVoiceRecording, type VoiceSession } from '../lib/voiceRecorder'
import {
  fetchConversation,
  fetchMessageFile,
  fetchMessages,
  markRead,
  openConversationWith,
  sendPhoto,
  sendText,
  sendVoice,
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
    if (!text) return
    setDraft('')
    enqueue({ type: 'text', text }, (threadId, clientId) => sendText(threadId, text, clientId))
  }

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
            })
            .catch(() => {})
        }
        void flush()
        return
      }
      if (event.conversation_id !== threadId) return
      if (event.type === 'message') {
        setMessages((current) => placeMessage(current, event.message))
        // Counted as read only if it could have been: a phone in a pocket
        // with the app in the background has read nothing.
        if (event.message.sender_id !== me?.id && document.visibilityState === 'visible') {
          markRead(threadId).catch(() => {})
        }
      } else if (event.type === 'read') {
        setOthersReadAt((current) => laterOf(current, event.read_at))
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

      <header className="cos-talk-head">
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
        <span className="cos-talk-who">{other?.display_name ?? ''}</span>
      </header>

      <div className="cos-talk-thread">
        {thread && messages.length === 0 && (
          <p className="cos-talk-empty">{t('talk.nothingYet', { name: other?.display_name ?? '' })}</p>
        )}

        {messages.map((message) => (
          // Keyed by the phone's own name where there is one, so a bubble
          // does not rebuild itself (and reload its photo) at the moment
          // its clock turns into a tick.
          <div className="cos-talk-row" key={message.client_id ?? message.id}>
            <div className={`cos-bubble${message.sender_id === me?.id ? ' is-mine' : ''}`}>
              {message.type === 'text' && message.text}

              {message.type === 'photo' && thread && (
                <MessagePhoto
                  conversationId={thread.id}
                  messageId={message.id}
                  localUrl={message.localUrl}
                  onOpen={setViewing}
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
                {new Date(message.created_at).toLocaleTimeString(i18n.language, {
                  hour: '2-digit',
                  minute: '2-digit',
                })}
                {message.sender_id === me?.id && <Ticks delivery={deliveryOf(message, othersReadAt)} />}
              </span>
            </div>

            {message.id === firstFlagged && (
              <PaymentWarning
                reported={reported}
                // Reporting yourself is not possible, and the warning under
                // your own card number is for you, not about you.
                canReport={message.sender_id !== me?.id}
                onReport={() => setReporting(true)}
              />
            )}
          </div>
        ))}
        <div ref={endRef} />
      </div>

      {error && thread && <p className="cos-talk-error">{error}</p>}

      <div className="cos-talk-say">
        {can('photo') && !recording && (
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
            onChange={(event) => setDraft(event.target.value)}
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
