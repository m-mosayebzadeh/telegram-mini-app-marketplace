/**
 * Which emoji to offer first.
 *
 * The owner's decision (TECHNICAL_REQUIREMENTS.md 29.13): a fixed starting
 * row, and after that the ones each person actually uses come forward by
 * themselves — the way Telegram does it — with no settings screen, because
 * almost nobody opens one.
 *
 * The counts live on this device. Keeping them on the server would follow a
 * person across devices, but it would turn every reaction into two writes
 * for a convenience; a new phone relearns someone's favourites within a day.
 */

/** The starting row: the everyday ones, plus the devil and the angel the
 *  owner asked for by name. */
export const STARTING_REACTIONS = ['❤️', '👍', '😂', '🔥', '😢', '😈', '😇'] as const

/** How many sit in the row before the arrow that opens the rest. Seven fit
 *  a small phone's width at a thumb-sized target each. */
export const ROW_LENGTH = STARTING_REACTIONS.length

const STORAGE_KEY = 'cosmos.emoji-use'

type Counts = Record<string, number>

function readCounts(): Counts {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : {}
    return parsed && typeof parsed === 'object' ? (parsed as Counts) : {}
  } catch {
    // Storage can be missing or blocked (private windows, some WebViews).
    // The row then simply stays the starting one.
    return {}
  }
}

/** Remembers that this emoji was used once more. */
export function recordEmojiUse(emoji: string): void {
  const counts = readCounts()
  counts[emoji] = (counts[emoji] ?? 0) + 1
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(counts))
  } catch {
    // Nothing to do: forgetting a favourite is harmless.
  }
}

/**
 * The row to show: the most used first, then the starting ones to fill it.
 *
 * Something has to be used more than once before it pushes a starting emoji
 * out, so a single stray tap does not rearrange the row somebody's thumb
 * has learned.
 */
export function reactionRow(counts: Counts = readCounts()): string[] {
  const favourites = Object.entries(counts)
    .filter(([, count]) => count >= 2)
    .sort((a, b) => b[1] - a[1])
    .map(([emoji]) => emoji)
  const row: string[] = []
  for (const emoji of [...favourites, ...STARTING_REACTIONS]) {
    if (!row.includes(emoji)) row.push(emoji)
    if (row.length === ROW_LENGTH) break
  }
  return row
}
