/**
 * Time-related pure helpers for the chat session UI
 * (TECHNICAL_REQUIREMENTS.md section 12): the elapsed-time header timer,
 * and grouping messages into date sections for the message list.
 */

import type { ChatMessage, MessageDateGroup } from './chatMessageTypes'

/**
 * Formats how long a session has been open as a stopwatch-style
 * MM:SS (or H:MM:SS past one hour) string — deliberately COUNTING UP,
 * never counting down, because a chat session never auto-expires on a
 * timer (TECHNICAL_REQUIREMENTS.md section 3); this is purely an
 * "elapsed so far" indicator, the same idea as a call-duration display.
 *
 * Digits only, no translated words — so it reads identically in both
 * locales without needing an interpolated string per language.
 *
 * `now` defaults to the real current time but is a parameter so this is
 * testable without mocking the system clock. Negative elapsed time
 * (e.g. a clock skew where `openedAt` is in the future) clamps to zero
 * rather than showing a negative duration.
 */
export function formatElapsedTime(openedAt: string, now: Date = new Date()): string {
  const openedMs = new Date(openedAt).getTime()
  const elapsedSeconds = Math.max(0, Math.floor((now.getTime() - openedMs) / 1000))

  const hours = Math.floor(elapsedSeconds / 3600)
  const minutes = Math.floor((elapsedSeconds % 3600) / 60)
  const seconds = elapsedSeconds % 60
  const pad = (n: number) => String(n).padStart(2, '0')

  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`
}

/**
 * Splits a chronologically-sorted message list into consecutive runs
 * that share the same calendar day (UTC date, matching how created_at
 * is stored/compared everywhere else in this app), for the message
 * list's date-separator rows ("Today", a full date, etc. — the actual
 * label formatting happens in the component, this just groups).
 *
 * Assumes `messages` is already sorted oldest-first (true for both the
 * mock generator's output and any real backend's, the same assumption
 * lib/mockChatData.ts's generator itself guarantees).
 */
export function groupMessagesByDate(messages: ChatMessage[]): MessageDateGroup[] {
  const groups: MessageDateGroup[] = []

  for (const message of messages) {
    const dateKey = message.created_at.slice(0, 10) // "YYYY-MM-DD"
    const currentGroup = groups[groups.length - 1]

    if (currentGroup && currentGroup.dateKey === dateKey) {
      currentGroup.messages.push(message)
    } else {
      groups.push({ dateKey, messages: [message] })
    }
  }

  return groups
}
