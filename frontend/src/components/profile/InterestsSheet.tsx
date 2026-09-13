import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Sheet } from '../ui/Sheet'
import { Button } from '../ui/Button'
import { IconClose } from '../icons'

interface InterestsSheetProps {
  value: string[]
  max: number
  onClose: () => void
  onSave: (interests: string[]) => void
  saving: boolean
}

/**
 * Adding and removing interests.
 *
 * It used to be one text field holding "کتاب، سینما، سفر" — which asked
 * the user to remember a separator, made a stray comma produce an empty
 * tag, and left them reading their own tags as a sentence rather than
 * seeing what the showcase will actually show.
 *
 * Type and press Enter: each entry becomes a chip, and every chip can be
 * removed on its own. What is on screen is exactly what will be saved
 * and exactly how it will look on a profile.
 */
export function InterestsSheet({ value, max, onClose, onSave, saving }: InterestsSheetProps) {
  const { t, i18n } = useTranslation()
  const [tags, setTags] = useState<string[]>(value)
  const [draft, setDraft] = useState('')

  const full = tags.length >= max

  function add() {
    const tag = draft.trim()
    if (!tag || full) return
    // A tag someone already has is not a second tag.
    if (!tags.some((existing) => existing.toLowerCase() === tag.toLowerCase())) {
      setTags([...tags, tag])
    }
    setDraft('')
  }

  function remove(tag: string) {
    setTags(tags.filter((existing) => existing !== tag))
  }

  return (
    <Sheet
      title={t('profilePage.interestsLabel')}
      onClose={onClose}
      footer={
        <Button variant="primary" size="lg" block loading={saving} onClick={() => onSave(tags)}>
          {t('profilePage.saveButton')}
        </Button>
      }
    >
      <div className="ui-field">
        <label className="ui-field-label" htmlFor="interest-draft">
          {t('profilePage.interestsAdd')}
          <span className="ui-field-counter">
            {tags.length.toLocaleString(i18n.language)} / {max.toLocaleString(i18n.language)}
          </span>
        </label>

        <input
          id="interest-draft"
          className="ui-input"
          value={draft}
          disabled={full}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            // Enter is the obvious key; a comma is accepted too, because
            // it is what the old field taught people to type.
            if (event.key === 'Enter' || event.key === ',') {
              event.preventDefault()
              add()
            }
            // Backspace on an empty field removes the last chip — the
            // behaviour every tag input has, and the quickest undo.
            if (event.key === 'Backspace' && !draft && tags.length > 0) {
              setTags(tags.slice(0, -1))
            }
          }}
          placeholder={t('profilePage.interestsPlaceholderShort')}
          autoFocus
        />

        <span className="ui-field-help">
          {full ? t('profilePage.interestsFull', { max }) : t('profilePage.interestsHint')}
        </span>
      </div>

      {/* Exactly the chips a profile will show, so there is nothing to
          imagine between typing and saving. */}
      {tags.length > 0 && (
        <div className="ep-tags">
          {tags.map((tag) => (
            <span className="ep-tag" key={tag}>
              {tag}
              <button
                type="button"
                className="ep-tag-remove"
                onClick={() => remove(tag)}
                aria-label={t('profilePage.interestsRemove', { tag })}
              >
                <IconClose size={14} />
              </button>
            </span>
          ))}
        </div>
      )}
    </Sheet>
  )
}
