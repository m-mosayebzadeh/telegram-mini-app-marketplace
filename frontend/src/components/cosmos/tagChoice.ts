import { groupOf, TAG_GROUPS, type TagGroup, type TonightTag } from '../../lib/echoApi'

/**
 * Which interests the Echo interest picker offers, and in what order
 * (section 32).
 *
 * Kept apart from TagPicker.tsx so that file exports only the component: the
 * development server can then swap the component in place on every save
 * instead of reloading the whole app.
 */

/** How many of the most chosen right now get the one-tap row. */
export const NOW_COUNT = 5

/** The most chosen in Echo right now that you have not chosen. Only the
 *  ones the server marks (chosen by enough people that the order gives no
 *  single person away), so with few people in Echo the row is empty and
 *  not shown. */
export function nowTags(order: readonly TonightTag[], chosen: readonly string[]): string[] {
  return order.filter((item) => item.tonight && !chosen.includes(item.tag)).slice(0, NOW_COUNT).map((item) => item.tag)
}

/** One group's interests, in the order of what is chosen right now. */
export function groupTags(group: TagGroup, order: readonly TonightTag[], chosen: readonly string[]): string[] {
  const inGroup = TAG_GROUPS[group] as readonly string[]
  return order.map((item) => item.tag).filter((tag) => inGroup.includes(tag) && !chosen.includes(tag))
}

/** What was typed, matched against every interest and every group's name
 *  (typing a group's name finds everything in it). */
export function findTags(
  query: string,
  order: readonly TonightTag[],
  chosen: readonly string[],
  labelOf: (tag: string) => string,
  groupLabelOf: (group: TagGroup) => string,
): string[] {
  const wanted = query.trim().toLocaleLowerCase()
  if (wanted === '') return []
  const hit = (text: string) => text.toLocaleLowerCase().includes(wanted)
  return order
    .map((item) => item.tag)
    .filter((tag) => {
      if (chosen.includes(tag)) return false
      const group = groupOf(tag)
      return hit(labelOf(tag)) || tag.includes(wanted) || (group !== undefined && hit(groupLabelOf(group)))
    })
}
