/**
 * Searching inside one chat (the chat menu's "Search", section 32).
 *
 * Done on the phone, over the messages already on screen: a chat loads
 * all of its messages at once, so asking the server again would only find
 * the same ones slower.
 */

interface Searchable {
  id: number
  type: string
  text: string | null
  pending?: boolean
}

/** Lower-case, and Arabic letter forms folded into their Persian ones, so
 *  "كتاب" typed on an Arabic keyboard still finds "کتاب". */
function fold(text: string): string {
  return text.toLocaleLowerCase().replace(/ي/g, 'ی').replace(/ك/g, 'ک')
}

/**
 * The messages whose text contains the query, newest first — the order
 * Telegram steps through results in, since what you are looking for is
 * most often recent. Empty for an empty query. Messages still on their
 * way have no place to jump to yet, so they are left out.
 */
export function findInChat(messages: readonly Searchable[], query: string): number[] {
  const wanted = fold(query.trim())
  if (wanted === '') return []
  return messages
    .filter((m) => !m.pending && m.type === 'text' && m.text && fold(m.text).includes(wanted))
    .map((m) => m.id)
    .reverse()
}
