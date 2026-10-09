/**
 * A ring that lights the moment somebody arrives (section 43): the world's
 * people with one person's "here now" changed, as the live connection
 * told it. The same list back when nothing changes, so React draws
 * nothing — a presence event about somebody not in this world, or one
 * that only repeats what is shown, costs no frame at all.
 */
export function withPresence<T extends { user_id: number; online: boolean }>(
  people: T[] | null,
  userId: number,
  online: boolean,
): T[] | null {
  if (!people?.some((person) => person.user_id === userId && person.online !== online)) return people
  return people.map((person) => (person.user_id === userId ? { ...person, online } : person))
}
