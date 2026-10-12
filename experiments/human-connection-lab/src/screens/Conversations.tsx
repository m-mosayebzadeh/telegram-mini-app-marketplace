/**
 * The list of conversations, grouped by what they need.
 *
 * "Your turn" comes first because nothing moves there until the visitor does.
 * There are no unread counts, read receipts or last-seen times — only where
 * each conversation stands, and whether they replied since you last looked.
 */

import { Seal } from '../ui/Seal';
import { useWorld } from '../state/WorldContext';
import { hrefFor } from '../state/router';
import { displayName, needsMe, visibleConversations, type Conversation } from '../domain/world';
import { depthLine, sealStateFor, statusLine } from './conversationText';

interface Props {
  /** The conversation open beside the list on wide screens, if any. */
  activeId?: string;
}

export function ConversationList({ activeId }: Props) {
  const { world } = useWorld();
  const all = visibleConversations(world);
  const mine = all.filter((c) => c.status === 'active' && needsMe(c));
  const talking = all.filter((c) => c.status === 'active' && !needsMe(c));
  const resting = all.filter((c) => c.status !== 'active');

  return (
    <div className="screen screen--list">
      <header className="screen-head">
        <h1 className="title">Conversations</h1>
      </header>
      {all.length === 0 ? (
        <div className="empty">
          <p className="empty__lead">No conversations yet.</p>
          <p className="empty__body">
            A conversation opens when you and someone else lean toward each other’s answers to today’s question.
            Nobody sees a lean that isn’t returned.
          </p>
          <a className="btn btn--primary" href={hrefFor({ name: 'today' })}>
            Go to today’s question
          </a>
        </div>
      ) : (
        <>
          <Group title="Your turn" items={mine} activeId={activeId} />
          <Group title="Talking" items={talking} activeId={activeId} />
          <Group title="At rest" items={resting} activeId={activeId} />
        </>
      )}
    </div>
  );
}

function Group({ title, items, activeId }: { title: string; items: Conversation[]; activeId?: string }) {
  if (items.length === 0) return null;
  return (
    <section className="convo-group" aria-label={title}>
      <h2 className="stamp convo-group__title">{title}</h2>
      <ul className="convo-rows">
        {items.map((c) => (
          <li key={c.id}>
            <a
              className={`convo-row ${c.id === activeId ? 'is-active' : ''}`}
              href={hrefFor({ name: 'conversations', id: c.id })}
              aria-current={c.id === activeId ? 'page' : undefined}
            >
              <Seal state={sealStateFor(c)} size={28} decorative />
              <span className="convo-row__text">
                <span className="convo-row__name">{displayName(c)}</span>
                <span className="convo-row__status">{statusLine(c)}</span>
                <span className="convo-row__progress">{depthLine(c)}</span>
              </span>
              <span className="convo-row__chevron" aria-hidden="true">
                ›
              </span>
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
