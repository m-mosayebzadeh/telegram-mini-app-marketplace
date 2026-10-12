/**
 * The words and seal state that describe where a conversation stands. Kept in
 * one place so the list, the header and the notices never disagree.
 */

import { DEPTHS } from '../domain/questions';
import { hasUnseenReply, isOpen, phaseOf, sharedDepth, type Conversation } from '../domain/world';
import type { SealState } from '../ui/Seal';

export function statusLine(c: Conversation): string {
  const phase = phaseOf(c);
  switch (phase.kind) {
    case 'pick':
      return 'Your turn to choose a question';
    case 'wait-pick':
      return 'They’re choosing the next question';
    case 'write':
      return phase.round.theirs ? 'Their half is sealed — write yours' : 'Write your half';
    case 'wait-half':
      return 'Waiting for their half';
    case 'ready':
      return 'Both halves are in — open them';
    case 'between':
    case 'exhausted':
      return hasUnseenReply(c) ? 'Replied to you' : 'Talking';
    case 'resting':
      return 'At rest';
  }
}

export function sealStateFor(c: Conversation): SealState {
  const phase = phaseOf(c);
  switch (phase.kind) {
    case 'write':
      return phase.round.theirs ? 'theirs' : 'none';
    case 'wait-half':
      return 'mine';
    case 'ready':
      return 'whole';
    default:
      return 'open';
  }
}

/** "Light", "Closer · kept", … — how far in, and whether they keep each other. */
export function depthLine(c: Conversation): string {
  const parts = [DEPTHS[sharedDepth(c)]!.title];
  if (isOpen(c, 'keep')) parts.push('Kept');
  if (c.status === 'resting') parts.push('At rest');
  return parts.join(' · ');
}
