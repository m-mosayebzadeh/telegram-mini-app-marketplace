/**
 * Short announcements of what the other people just did, plus any rule the
 * visitor ran into. One at a time, polite to screen readers, gone on their
 * own — and never shown for the conversation already on screen, where the
 * change is visible in place.
 */

import { useEffect } from 'react';
import { useWorld } from '../state/WorldContext';
import { hrefFor } from '../state/router';
import { DOORS } from '../domain/questions';
import { dismissNotice, displayName, nameInSentence, type Notice, type World } from '../domain/world';
import { personById } from '../domain/people';

const SHOW_MS = 5000;

function describe(world: World, n: Notice): string {
  const c = world.conversations.find((x) => x.id === n.conversationId);
  const who = c ? displayName(c) : `Someone in ${personById(n.personId).city}`;
  const mid = c ? nameInSentence(c) : `someone in ${personById(n.personId).city}`;
  switch (n.kind) {
    case 'mutual':
      return `You and ${mid} both leaned in. A conversation has opened.`;
    case 'their-half':
      return n.ready ? `Both halves are in with ${mid}. Open them together.` : `${who} sealed their half.`;
    case 'their-pick':
      return `${who} chose the next question.`;
    case 'their-reply':
      return `${who} replied to you.`;
    case 'door':
      return `A door opened with ${mid}. ${DOORS[n.door].opened}`;
  }
}

export function Notices({ visibleConversationId }: { visibleConversationId?: string }) {
  const { world, act, error, clearError } = useWorld();
  const notice = world.notices[0];
  const onScreen = notice && notice.kind !== 'mutual' && notice.conversationId === visibleConversationId;

  useEffect(() => {
    if (!notice) return;
    const t = window.setTimeout(() => act((w) => dismissNotice(w, notice.id)), onScreen ? 0 : SHOW_MS);
    return () => window.clearTimeout(t);
  }, [notice, onScreen, act]);

  useEffect(() => {
    if (!error) return;
    const t = window.setTimeout(clearError, SHOW_MS);
    return () => window.clearTimeout(t);
  }, [error, clearError]);

  return (
    <div className="notices" aria-live="polite" aria-atomic="true">
      {error && (
        <div className="notice notice--rule" role="alert">
          <p>{error}</p>
        </div>
      )}
      {notice && !onScreen && !error && (
        <div className="notice">
          <p>{describe(world, notice)}</p>
          <a
            className="notice__action"
            href={hrefFor({ name: 'conversations', id: notice.conversationId })}
            onClick={() => act((w) => dismissNotice(w, notice.id))}
          >
            Open
          </a>
        </div>
      )}
    </div>
  );
}
