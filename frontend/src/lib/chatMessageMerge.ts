import type { ChatMessage } from './chatMessageTypes'

/**
 * Merges a freshly-polled, server-authoritative message list (see
 * pages/ChatSessionDetail.tsx's polling effect, and
 * lib/chatMessageApi.ts's listMessages()) with whatever's currently in
 * local state.
 *
 * The server list is always trusted as-is for every message it already
 * knows about — but a message the viewer just composed (still 'sending',
 * or 'failed' and not yet retried) hasn't reached the server yet, so a
 * poll landing mid-send must not make its optimistic bubble vanish. Such
 * a message is recognized by its id: a real, server-assigned message id
 * is a plain numeric string (see lib/chatMessageApi.ts's toChatMessage),
 * while a message still waiting on deliverMessage() keeps the
 * client-generated "draft-..." id composeMessage() gave it until it
 * either succeeds (and gets swapped for the server's real row) or is
 * dropped.
 */
export function mergeMessages(serverMessages: ChatMessage[], localMessages: ChatMessage[]): ChatMessage[] {
  const serverIds = new Set(serverMessages.map((m) => m.id))
  const pendingLocalOnly = localMessages.filter((m) => m.id.startsWith('draft-') && !serverIds.has(m.id))

  return [...serverMessages, ...pendingLocalOnly].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
  )
}
