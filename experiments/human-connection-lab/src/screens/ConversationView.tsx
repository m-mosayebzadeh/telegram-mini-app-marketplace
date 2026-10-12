/**
 * One conversation: rounds, the talk under them, and the doors between you.
 *
 * Each round is a question and two halves divided by a seam, with the seal on
 * the seam showing which halves are in. Once a round is open, a thread opens
 * under it: either person can reply, and can pick a line from the other's half
 * to reply to. Thresholds — going deeper, sharing a name, keeping each other —
 * are doors at the end, where the thumb is; each opens only when both knock.
 */

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Composer } from '../ui/Composer';
import { Redacted } from '../ui/Redacted';
import { Seal, type SealState } from '../ui/Seal';
import { Sheet } from '../ui/Sheet';
import { useWorld } from '../state/WorldContext';
import { hrefFor, navigate } from '../state/router';
import { personById } from '../domain/people';
import { DEPTHS, DOORS, REVEAL_COPY, questionById, type DoorId } from '../domain/questions';
import {
  MAX_REPLY_LENGTH,
  block,
  displayName,
  doorAvailable,
  hasUnseenReply,
  isOpen,
  knock,
  letRest,
  markSeen,
  nameInSentence,
  nextQuestion,
  openRound,
  phaseOf,
  pickQuestion,
  reply,
  sealRoundHalf,
  unknock,
  visibleDoors,
  type Conversation,
  type Phase,
  type Reply,
  type Round,
  type ThreadRef,
} from '../domain/world';
import { formatShortDay } from './format';
import { depthLine } from './conversationText';

interface Props {
  id: string;
  /** On a phone the conversation is a pushed screen with its own back button. */
  pushed: boolean;
}

export function ConversationView({ id, pushed }: Props) {
  const { world, act } = useWorld();
  const c = world.conversations.find((x) => x.id === id && !x.blocked);
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [replyingTo, setReplyingTo] = useState<ThreadRef | null>(null);
  const [sheet, setSheet] = useState<'options' | 'rest' | 'block' | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const closeSheet = () => setSheet(null);

  const phaseKind = c ? phaseOf(c).kind : null;
  const roundCount = c?.rounds.length ?? 0;

  // Bring the next thing to do into view when it changes. On arrival it jumps
  // there: gliding through a long conversation is a wait, not a transition.
  const arrived = useRef(false);
  useEffect(() => {
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    endRef.current?.scrollIntoView?.({ block: 'end', behavior: !arrived.current || reduce ? 'auto' : 'smooth' });
    arrived.current = true;
  }, [phaseKind, roundCount, id]);

  // Looking at the conversation means their replies are no longer new.
  const unseen = c ? hasUnseenReply(c) : false;
  useEffect(() => {
    if (unseen) act((w, t) => markSeen(w, t, id));
  }, [unseen, id, act]);

  // The opening animation runs once, for the round that was just opened.
  useEffect(() => {
    if (!openingId) return;
    const t = window.setTimeout(() => setOpeningId(null), 900);
    return () => window.clearTimeout(t);
  }, [openingId]);

  if (!c) {
    return (
      <div className="screen conversation">
        <div className="empty">
          <p className="empty__lead">This conversation isn’t here.</p>
          <p className="empty__body">It may have been reset or blocked.</p>
          <a className="btn btn--primary" href={hrefFor({ name: 'conversations' })}>
            All conversations
          </a>
        </div>
      </div>
    );
  }

  const person = personById(c.personId);
  const name = displayName(c);
  const phase = phaseOf(c);
  const active = c.status === 'active';
  const sub = isOpen(c, 'work') ? person.work : isOpen(c, 'names') ? person.city : '';

  const sendReply = (ref: ThreadRef, text: string, quote?: string) => {
    const ok = act((w, t) => reply(w, t, c.id, ref, text, quote));
    if (ok) setReplyingTo(null);
    return ok;
  };

  // A door's opening sits in the story where it happened: after the last round opened before it.
  const doorsAfter = (index: number) =>
    visibleDoors(c).filter((d) => {
      const at = c.doors[d]?.openedAt;
      if (at === undefined) return false;
      const placedAt = c.rounds.filter((r) => (r.openedAt ?? Infinity) <= at).length - 1;
      return placedAt === index;
    });

  // The thread the panel at the end talks about: the latest opened round, or where you met.
  const latestOpened = c.rounds.filter((r) => r.openedAt !== undefined).at(-1);
  const latestRef: ThreadRef = latestOpened?.id ?? 'met';
  const latestReplies = latestOpened ? latestOpened.thread : c.met.thread;
  const repliedToLatest = latestReplies.some((m) => m.by === 'me');

  const threadProps = (ref: ThreadRef) => ({
    refId: ref,
    name,
    open: replyingTo === ref,
    canReply: active,
    // While the latest round has no replies, the panel below carries the invitation; one is enough.
    hideOpener: ref === latestRef && latestReplies.length === 0 && phase.kind === 'between',
    onOpen: () => setReplyingTo(ref),
    onCancel: () => setReplyingTo(null),
    onSend: sendReply,
  });

  return (
    <div className="screen conversation">
      <header className="convo-head">
        {pushed && (
          <a className="icon-btn convo-head__back" href={hrefFor({ name: 'conversations' })} aria-label="Back to conversations">
            <span aria-hidden="true">‹</span>
          </a>
        )}
        <div className="convo-head__text">
          <h1 className="convo-head__name">{name}</h1>
          <p className="convo-head__sub">{[depthLine(c), sub].filter(Boolean).join(' · ')}</p>
        </div>
        <button type="button" className="icon-btn" aria-label="Conversation options" onClick={() => setSheet('options')}>
          <span aria-hidden="true">···</span>
        </button>
      </header>

      <div className="convo-body">
        <section className="met" aria-label="Where you met">
          <p className="stamp">Where you met · {formatShortDay(c.startedAt)}</p>
          <RoundView
            question={questionById(c.met.questionId).text}
            theirsLabel={name}
            mine={c.met.mine}
            theirs={c.met.theirs}
            state="open"
          />
          <Thread replies={c.met.thread} theirText={c.met.theirs} {...threadProps('met')} />
          {doorsAfter(-1).map((d) => (
            <DoorOutcome key={d} c={c} door={d} />
          ))}
        </section>

        {c.rounds.map((r, i) => (
          <section key={r.id} className="round-block" aria-label={`Round ${i + 1}`}>
            <RoundBlock c={c} r={r} name={name} opening={openingId === r.id} />
            {r.openedAt !== undefined && <Thread replies={r.thread} theirText={r.theirs?.text ?? ''} {...threadProps(r.id)} />}
            {doorsAfter(i).map((d) => (
              <DoorOutcome key={d} c={c} door={d} />
            ))}
          </section>
        ))}

        <div className="convo-next" ref={endRef}>
          <NextStep
            c={c}
            phase={phase}
            name={name}
            replying={replyingTo !== null}
            replied={repliedToLatest}
            onReply={() => setReplyingTo(latestRef)}
            onOpen={(roundId) => {
              if (act((w, t) => openRound(w, t, c.id))) setOpeningId(roundId);
            }}
            onPick={(questionId) => act((w, t) => pickQuestion(w, t, c.id, questionId))}
            onNext={() => act((w, t) => nextQuestion(w, t, c.id))}
          />
          {active && <Doors c={c} />}
        </div>
      </div>

      {sheet === 'options' && (
        <Sheet title="Conversation options" onClose={closeSheet}>
          <div className="sheet__actions">
            {active && (
              <button type="button" className="sheet-row" onClick={() => setSheet('rest')}>
                <span className="sheet-row__title">Let it rest</span>
                <span className="sheet-row__body">End gently, with a closing line instead of silence.</span>
              </button>
            )}
            <button type="button" className="sheet-row" onClick={() => setSheet('block')}>
              <span className="sheet-row__title">Block</span>
              <span className="sheet-row__body">End for good. They won’t appear in Today again.</span>
            </button>
          </div>
          <button type="button" className="btn btn--quiet btn--wide" onClick={closeSheet}>
            Cancel
          </button>
        </Sheet>
      )}
      {sheet === 'rest' && (
        <RestSheet
          onClose={closeSheet}
          onRest={(line) => {
            if (act((w, t) => letRest(w, t, c.id, line))) closeSheet();
          }}
        />
      )}
      {sheet === 'block' && (
        <Sheet title={`Block ${nameInSentence(c)}?`} onClose={closeSheet}>
          <p className="sheet__body">
            This conversation ends for good and they won’t appear in Today again. They won’t be told.
          </p>
          <div className="sheet__buttons">
            <button type="button" className="btn btn--quiet" onClick={closeSheet}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn--primary"
              onClick={() => {
                if (act((w, t) => block(w, t, c.personId))) navigate({ name: 'conversations' });
              }}
            >
              Block
            </button>
          </div>
        </Sheet>
      )}
    </div>
  );
}

// ─── A round: question, two halves, the seam and its seal ────────────────────

function RoundBlock({ c, r, name, opening }: { c: Conversation; r: Round; name: string; opening: boolean }) {
  const { act } = useWorld();
  const open = r.openedAt !== undefined;
  const state: SealState = open ? 'open' : r.mine && r.theirs ? 'whole' : r.mine ? 'mine' : r.theirs ? 'theirs' : 'none';
  const writing = !open && !r.mine && c.status === 'active';

  return (
    <RoundView
      question={questionById(r.questionId).text}
      meta={`${r.pickedBy === 'me' ? 'You chose' : `${name} chose`} · ${DEPTHS[r.depth]!.title}`}
      theirsLabel={name}
      mine={r.mine?.text}
      theirs={open ? r.theirs?.text : undefined}
      theirsSealed={!open && Boolean(r.theirs)}
      mineSealed={!open && Boolean(r.mine)}
      state={state}
      opening={opening}
      composer={
        writing ? (
          <Composer
            variant="inline"
            label="Your half"
            hint={r.theirs ? 'Their half is sealed. Write yours to open both.' : 'They’re writing theirs without seeing yours.'}
            onSeal={(text) => act((w, t) => sealRoundHalf(w, t, c.id, text))}
          />
        ) : undefined
      }
    />
  );
}

interface RoundViewProps {
  question: string;
  meta?: string;
  theirsLabel: string;
  mine?: string;
  theirs?: string;
  mineSealed?: boolean;
  theirsSealed?: boolean;
  state: SealState;
  opening?: boolean;
  composer?: ReactNode;
}

function RoundView(p: RoundViewProps) {
  return (
    <article className={`exchange exchange--${p.state} ${p.opening ? 'is-opening' : ''}`}>
      <header className="exchange__head">
        {p.meta && <p className="meta">{p.meta}</p>}
        <h3 className="title exchange__question">{p.question}</h3>
      </header>
      {/* Theirs first in reading order, yours last, so what you still have to write ends the round. */}
      <div className="halves">
        <section className="half half--theirs" aria-label={`Half from ${p.theirsLabel}`}>
          <p className="half__label">{p.theirsLabel}</p>
          {p.theirs ? (
            <p className="voice half__text">{p.theirs}</p>
          ) : p.theirsSealed ? (
            <>
              <Redacted />
              <p className="stamp stamp--seal">Sealed</p>
            </>
          ) : (
            <p className="half__waiting">Not written yet</p>
          )}
        </section>
        <div className="seam" aria-hidden={p.state === 'open'}>
          <Seal state={p.state} size={28} />
        </div>
        <section className="half half--mine" aria-label="Your half">
          <p className="half__label">You</p>
          {p.composer ?? (
            <>
              {p.mine && <p className="voice half__text">{p.mine}</p>}
              {p.mineSealed && <p className="stamp stamp--seal">Sealed · can’t be edited</p>}
            </>
          )}
        </section>
      </div>
    </article>
  );
}

// ─── The thread under an opened round ────────────────────────────────────────

/** Splits a half into lines someone could reply to. */
function linesOf(text: string): string[] {
  return text
    .split(/(?<=[.!?…”"])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 3);
}

interface ThreadProps {
  refId: ThreadRef;
  replies: Reply[];
  theirText: string;
  name: string;
  open: boolean;
  canReply: boolean;
  onOpen: () => void;
  onCancel: () => void;
  onSend: (ref: ThreadRef, text: string, quote?: string) => boolean;
  hideOpener?: boolean;
}

function Thread({ refId, replies, theirText, name, open, canReply, onOpen, onCancel, onSend, hideOpener }: ThreadProps) {
  if (replies.length === 0 && !open && (!canReply || hideOpener)) return null;
  return (
    <div className="thread">
      {replies.length > 0 && (
        <ol className="thread__list" aria-label="Replies">
          {replies.map((m) => (
            <li key={m.id} className={`reply reply--${m.by}`}>
              <p className="reply__who">{m.by === 'me' ? 'You' : name}</p>
              {m.quote && <blockquote className="reply__quote">{m.quote}</blockquote>}
              <p className="reply__text">{m.text}</p>
            </li>
          ))}
        </ol>
      )}
      {canReply &&
        (open ? (
          <ReplyComposer lines={linesOf(theirText)} name={name} onCancel={onCancel} onSend={(t, q) => onSend(refId, t, q)} />
        ) : (
          !hideOpener && (
            // Short and the same under every round: the panel at the end carries the full invitation.
            <button type="button" className="thread__open" onClick={onOpen}>
              Reply
            </button>
          )
        ))}
    </div>
  );
}

function ReplyComposer({
  lines,
  name,
  onCancel,
  onSend,
}: {
  lines: string[];
  name: string;
  onCancel: () => void;
  onSend: (text: string, quote?: string) => boolean;
}) {
  const [text, setText] = useState('');
  const [quote, setQuote] = useState<string | undefined>();
  const [picking, setPicking] = useState(false);
  const ready = text.trim().length > 0 && text.length <= MAX_REPLY_LENGTH;

  return (
    <form
      className="reply-composer"
      onSubmit={(e) => {
        e.preventDefault();
        if (ready) onSend(text, quote);
      }}
    >
      {quote ? (
        <div className="reply-composer__quote">
          <blockquote className="reply__quote">{quote}</blockquote>
          <button type="button" className="link-btn" onClick={() => setQuote(undefined)}>
            Remove
          </button>
        </div>
      ) : picking ? (
        <div className="lines" role="group" aria-label={`Lines from ${name}’s half`}>
          <p className="meta">Tap the line you want to reply to.</p>
          {lines.map((l) => (
            <button
              key={l}
              type="button"
              className="line"
              onClick={() => {
                setQuote(l);
                setPicking(false);
              }}
            >
              {l}
            </button>
          ))}
        </div>
      ) : (
        lines.length > 0 && (
          <button type="button" className="link-btn reply-composer__pick" onClick={() => setPicking(true)}>
            Reply to a line from their half
          </button>
        )
      )}
      <label className="visually-hidden" htmlFor="reply-field">
        Your reply
      </label>
      <textarea
        id="reply-field"
        className="reply-composer__field"
        value={text}
        rows={2}
        placeholder="Ask them more, or tell them what it stirred in you…"
        maxLength={MAX_REPLY_LENGTH}
        autoFocus
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && ready) {
            e.preventDefault();
            onSend(text, quote);
          }
        }}
      />
      <div className="reply-composer__foot">
        <button type="button" className="btn btn--quiet" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className="btn btn--primary" disabled={!ready}>
          Send reply
        </button>
      </div>
    </form>
  );
}

// ─── What comes next ─────────────────────────────────────────────────────────

interface NextProps {
  c: Conversation;
  phase: Phase;
  name: string;
  replying: boolean;
  /** Whether the visitor has already replied under the latest round. */
  replied: boolean;
  onReply: () => void;
  onOpen: (roundId: string) => void;
  onPick: (questionId: string) => void;
  onNext: () => void;
}

function NextStep({ c, phase, name, replying, replied, onReply, onOpen, onPick, onNext }: NextProps) {
  const named = isOpen(c, 'names');
  switch (phase.kind) {
    case 'pick':
      return (
        <div className="next next--pick">
          <p className="next__lead">Your turn to choose the next question.</p>
          <div className="choices">
            {phase.offer.questionIds.map((qid) => (
              <button key={qid} type="button" className="choice" onClick={() => onPick(qid)}>
                <span className="choice__text">{questionById(qid).text}</span>
                <span className="choice__cta">Ask this</span>
              </button>
            ))}
          </div>
        </div>
      );
    case 'wait-pick':
      return <Waiting lead={`${name} is choosing the next question.`} body="It will appear here. Meanwhile, the replies above are still open." />;
    case 'write':
      // The composer lives inside the visitor's half, above.
      return null;
    case 'wait-half':
      return <Waiting lead="Your half is sealed." body={`Both open together once ${named ? `${name} has` : 'they have'} written theirs.`} />;
    case 'ready':
      return (
        <div className="next next--ready">
          <Seal state="whole" size={56} />
          <p className="next__lead">Both halves are in.</p>
          <p className="next__body">Neither of you has read the other’s yet. Open them together.</p>
          <button type="button" className="btn btn--seal btn--wide" onClick={() => onOpen(phase.round.id)}>
            Open both halves
          </button>
        </div>
      );
    case 'between': {
      if (replying) return null;
      const yourTurn = c.rounds.length % 2 === 0;
      const nextLabel = yourTurn ? 'Next question · you choose' : `Next question · ${named ? `${name} chooses` : 'they choose'}`;
      // Before you've responded, responding leads; once you have, moving on does.
      return (
        <div className="next next--between">
          <p className="next__body">
            {replied
              ? 'When you’re ready, ask for the next question — or keep talking above.'
              : 'Say something about what they wrote — a question, or what it stirred in you. When you’re ready, ask for the next question.'}
          </p>
          <div className="next__actions">
            {!replied && (
              <button type="button" className="btn btn--primary" onClick={onReply}>
                Reply to their half
              </button>
            )}
            <button type="button" className={`btn ${replied ? 'btn--primary' : 'btn--quiet'}`} onClick={onNext}>
              {nextLabel}
            </button>
          </div>
        </div>
      );
    }
    case 'exhausted':
      return (
        <div className="next next--waiting" role="status">
          <div>
            <p className="next__lead">You’ve asked each other every question at this depth.</p>
            <p className="next__body">
              {isOpen(c, 'deep')
                ? 'That’s every question Halfway has for now. The replies above stay open.'
                : 'Keep talking in the replies above, or open a door to go deeper.'}
            </p>
          </div>
        </div>
      );
    case 'resting':
      return <RestingNote c={c} />;
  }
}

function Waiting({ lead, body }: { lead: string; body: string }) {
  return (
    <div className="next next--waiting" role="status">
      <span className="next__pulse" aria-hidden="true" />
      <div>
        <p className="next__lead">{lead}</p>
        <p className="next__body">{body}</p>
      </div>
    </div>
  );
}

function RestingNote({ c }: { c: Conversation }) {
  return (
    <div className="next next--closed">
      <Seal state="open" size={28} decorative />
      <p className="next__lead">You let this conversation rest.</p>
      {c.rest?.closingLine ? (
        <p className="next__body">
          Your closing line: <q className="voice-inline">{c.rest.closingLine}</q>
        </p>
      ) : (
        <p className="next__body">Everything you wrote together stays here for you to reread.</p>
      )}
    </div>
  );
}

// ─── Doors ───────────────────────────────────────────────────────────────────

/** The thresholds between you. Each opens only when both have knocked. */
function Doors({ c }: { c: Conversation }) {
  const closed = visibleDoors(c).filter((d) => !isOpen(c, d) && doorAvailable(c, d));
  if (closed.length === 0) return null;
  return (
    <section className="doors" aria-labelledby={`doors-${c.id}`}>
      <h2 className="stamp" id={`doors-${c.id}`}>
        Doors between you
      </h2>
      <p className="doors__explain">A door opens only when you’ve both knocked. A knock that isn’t answered is never shown.</p>
      <ul className="doors__list">
        {closed.map((d) => (
          <DoorRow key={d} c={c} door={d} />
        ))}
      </ul>
    </section>
  );
}

function DoorRow({ c, door }: { c: Conversation; door: DoorId }) {
  const { world, act } = useWorld();
  const def = DOORS[door];
  const knocked = c.doors[door]?.mine !== undefined;
  const [asking, setAsking] = useState(false);
  const [value, setValue] = useState(def.reveal ? (world.me[def.reveal] ?? '') : '');

  const doKnock = () => act((w, t) => knock(w, t, c.id, door, def.reveal ? value : undefined));

  return (
    <li className={`door ${knocked ? 'is-knocked' : ''}`}>
      <Seal state={knocked ? 'mine' : 'none'} size={28} decorative />
      <div className="door__text">
        <p className="door__title">{def.title}</p>
        <p className="door__body">{knocked ? 'You knocked. It opens if they knock too — you’ll only know if it does.' : def.body}</p>
        {asking && def.reveal && !knocked && (
          <form
            className="door__share"
            onSubmit={(e) => {
              e.preventDefault();
              if (value.trim() && doKnock()) setAsking(false);
            }}
          >
            <label className="field">
              <span className="field__label">{REVEAL_COPY[def.reveal].field}</span>
              <input
                className="field__input"
                value={value}
                placeholder={REVEAL_COPY[def.reveal].placeholder}
                maxLength={80}
                autoFocus
                onChange={(e) => setValue(e.target.value)}
              />
            </label>
            <p className="meta">Shown to them only if they knock too.</p>
            <div className="door__share-buttons">
              <button type="button" className="btn btn--quiet" onClick={() => setAsking(false)}>
                Cancel
              </button>
              <button type="submit" className="btn btn--seal" disabled={!value.trim()}>
                Knock
              </button>
            </div>
          </form>
        )}
      </div>
      {!asking &&
        (knocked ? (
          <button
            type="button"
            className="door__action door__action--undo"
            aria-label={`Take back your knock on “${def.title}”`}
            onClick={() => act((w, t) => unknock(w, t, c.id, door))}
          >
            Take back
          </button>
        ) : (
          <button
            type="button"
            className="door__action"
            aria-label={`Knock on “${def.title}”`}
            onClick={() => (def.reveal ? setAsking(true) : doKnock())}
          >
            Knock
          </button>
        ))}
    </li>
  );
}

function DoorOutcome({ c, door }: { c: Conversation; door: DoorId }) {
  const person = personById(c.personId);
  const detail: Record<DoorId, string> = {
    names: `They’re ${person.firstName}.`,
    work: `What they do: ${person.work}.`,
    closer: 'New questions reach a little further in.',
    deep: 'New questions can ask about what matters.',
    keep: 'Their answer to each day’s question will be waiting on Today, once you’ve written yours.',
  };
  return (
    <div className="outcome" role="note">
      <Seal state="open" size={16} decorative />
      <p>
        {DOORS[door].opened} {detail[door]}
      </p>
    </div>
  );
}

// ─── Letting it rest ─────────────────────────────────────────────────────────

const CLOSING_LINES = [
  'Thank you for this. I’m glad we met halfway.',
  'I need to step back for now. Thank you for every half you wrote.',
  'This was lovely. I’ll keep it.',
] as const;

function RestSheet({ onClose, onRest }: { onClose: () => void; onRest: (line: string) => void }) {
  const [choice, setChoice] = useState<number | 'own'>(0);
  const [own, setOwn] = useState('');
  const line = choice === 'own' ? own : (CLOSING_LINES[choice] ?? '');
  return (
    <Sheet title="Let it rest" onClose={onClose}>
      <p className="sheet__body">They’ll see your closing line instead of silence.</p>
      <fieldset className="options">
        <legend className="visually-hidden">Closing line</legend>
        {CLOSING_LINES.map((l, i) => (
          <label key={l} className={`option ${choice === i ? 'is-selected' : ''}`}>
            <input type="radio" name="closing" checked={choice === i} onChange={() => setChoice(i)} />
            <span className="option__title voice-inline">{l}</span>
          </label>
        ))}
        <label className={`option ${choice === 'own' ? 'is-selected' : ''}`}>
          <input type="radio" name="closing" checked={choice === 'own'} onChange={() => setChoice('own')} />
          <span className="option__title">Write my own</span>
        </label>
      </fieldset>
      {choice === 'own' && (
        <label className="field">
          <span className="field__label">Your closing line</span>
          <input className="field__input" value={own} maxLength={160} onChange={(e) => setOwn(e.target.value)} autoFocus />
        </label>
      )}
      <div className="sheet__buttons">
        <button type="button" className="btn btn--quiet" onClick={onClose}>
          Cancel
        </button>
        <button type="button" className="btn btn--primary" disabled={choice === 'own' && !own.trim()} onClick={() => onRest(line)}>
          Let it rest
        </button>
      </div>
    </Sheet>
  );
}
