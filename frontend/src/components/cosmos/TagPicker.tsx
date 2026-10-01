import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  fetchTonightTags,
  groupOf,
  GROUPS,
  MAX_TAGS,
  SEARCH_TAGS,
  TAG_GROUPS,
  type TagGroup,
  type TonightTag,
} from '../../lib/echoApi'

/**
 * Choosing interests for an Echo search (section 32, the owner's design).
 *
 * The list will grow to two hundred and more, so it is never shown whole.
 * A handful of groups instead — tap one to see what is in it, and back —
 * which also tells people there is more than what is on the screen, the
 * thing "only the ten most chosen" could not. Above the groups, a row of
 * the few interests most chosen in Echo right now, one tap each, since
 * going into a group is a second tap for the commonest choice. Typing
 * finds interests themselves, from every group at once, each with its
 * group's name beside it, so a search is one tap from a choice too.
 *
 * What you have chosen stays above everything, whatever is open; taken off,
 * an interest goes back to its own place.
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

/** The list's own order, for before the server answers or if it cannot. */
const FALLBACK: TonightTag[] = SEARCH_TAGS.map((tag) => ({ tag, tonight: false }))

export function TagPicker({ chosen, onToggle }: { chosen: string[]; onToggle: (tag: string) => void }) {
  const { t, i18n } = useTranslation()
  const [order, setOrder] = useState<TonightTag[]>(FALLBACK)
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState<TagGroup | null>(null)

  useEffect(() => {
    let alive = true
    fetchTonightTags()
      .then((list) => {
        if (alive && Array.isArray(list) && list.length > 0) setOrder(list)
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [])

  const labelOf = (tag: string) => t(`echo.tag.${tag}`)
  const groupLabelOf = (group: TagGroup) => t(`echo.group.${group}`)
  const full = chosen.length >= MAX_TAGS

  const chip = (tag: string, withGroup = false) => {
    const on = chosen.includes(tag)
    const group = withGroup ? groupOf(tag) : undefined
    return (
      <button
        key={tag}
        type="button"
        className="cos-seek-tag"
        aria-pressed={on}
        disabled={!on && full}
        onClick={() => onToggle(tag)}
      >
        {labelOf(tag)}
        {group && <small className="cos-tagpick-of">{groupLabelOf(group)}</small>}
      </button>
    )
  }

  const searching = query.trim() !== ''
  const now = nowTags(order, chosen)
  const found = searching ? findTags(query, order, chosen, labelOf, groupLabelOf) : []

  return (
    <div className="cos-tagpick">
      <input
        className="cos-tagpick-field"
        type="search"
        value={query}
        placeholder={t('seek.findTag')}
        aria-label={t('seek.findTag')}
        onChange={(event) => setQuery(event.target.value)}
      />

      {chosen.length > 0 && (
        <div className="cos-seek-tags cos-tagpick-chosen" role="group" aria-label={t('seek.chosen')}>
          {chosen.map((tag) => chip(tag))}
        </div>
      )}

      {searching ? (
        <div className="cos-seek-tags" role="group" aria-label={t('echo.tagsLabel')}>
          {found.map((tag) => chip(tag, true))}
          {found.length === 0 && (
            <p className="cos-tagpick-none">{t('seek.noTag')}</p>
          )}
        </div>
      ) : open ? (
        <div className="cos-tagpick-inside">
          <button type="button" className="cos-tagpick-back" onClick={() => setOpen(null)}>
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
              <path d="M15 5 8 12l7 7" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span>{t('seek.allGroups')}</span>
          </button>
          <h3 className="cos-tagpick-title">{groupLabelOf(open)}</h3>
          <div className="cos-seek-tags" role="group" aria-label={groupLabelOf(open)}>
            {groupTags(open, order, chosen).map((tag) => chip(tag))}
          </div>
        </div>
      ) : (
        <>
          {now.length > 0 && (
            <div className="cos-tagpick-now">
              <p className="cos-tagpick-caption">{t('seek.now')}</p>
              <div className="cos-seek-tags" role="group" aria-label={t('seek.now')}>
                {now.map((tag) => chip(tag))}
              </div>
            </div>
          )}
          <div className="cos-tagpick-groups" role="group" aria-label={t('seek.groups')}>
            {GROUPS.map((group) => {
              const picked = chosen.filter((tag) => groupOf(tag) === group).length
              return (
                <button key={group} type="button" className="cos-tagpick-group" onClick={() => setOpen(group)}>
                  <b>{groupLabelOf(group)}</b>
                  {/* A taste of what is inside, so a group is not a closed door. */}
                  <span>{(TAG_GROUPS[group] as readonly string[]).slice(0, 3).map(labelOf).join('، ')}…</span>
                  {picked > 0 && <i className="cos-tagpick-picked" aria-label={t('seek.pickedHere', { n: picked })} role="img">{picked.toLocaleString(i18n.language)}</i>}
                </button>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}
