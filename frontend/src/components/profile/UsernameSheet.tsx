import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Sheet } from '../ui/Sheet'
import { Button } from '../ui/Button'

/** a-z, A-Z, 0-9 and underscore, 3 to 32 — the same rule the backend
 *  enforces (see app/main.py's USERNAME_PATTERN). */
const USERNAME_PATTERN = /^[a-zA-Z0-9_]{3,32}$/

interface UsernameSheetProps {
  value: string
  onClose: () => void
  onSave: (username: string) => void
  saving: boolean
  /** A server-side refusal — taken, or invalid. */
  error: string | null
  onErrorCleared: () => void
}

/**
 * Choosing a username, or giving it up.
 *
 * Two things it gets right that the old field did not. The "@" belongs
 * to the FIELD and is never part of what is typed, so it cannot be
 * backspaced away. And because a username is always Latin, the input
 * runs left-to-right with the @ at its left edge regardless of the
 * page's direction — an @ that jumps to the right-hand end under Persian
 * is not a prefix any more, it is a decoration in the wrong place.
 *
 * Clearing it is allowed and is a real action, not an accident: the
 * field can be emptied and saved, because a username is optional and
 * someone who no longer wants one has to be able to say so.
 */
export function UsernameSheet({
  value,
  onClose,
  onSave,
  saving,
  error,
  onErrorCleared,
}: UsernameSheetProps) {
  const { t } = useTranslation()
  const [draft, setDraft] = useState(value)

  const trimmed = draft.trim()
  const invalid = trimmed.length > 0 && !USERNAME_PATTERN.test(trimmed)
  // Emptying it is a legitimate save, so the button stays live; only a
  // malformed value blocks it.
  const clearing = trimmed.length === 0 && value.length > 0

  return (
    <Sheet
      title={t('profilePage.usernameLabel')}
      onClose={onClose}
      footer={
        <Button
          variant={clearing ? 'danger' : 'primary'}
          size="lg"
          block
          disabled={invalid || (trimmed.length === 0 && value.length === 0)}
          loading={saving}
          onClick={() => onSave(trimmed)}
        >
          {clearing ? t('profilePage.usernameRemove') : t('profilePage.saveButton')}
        </Button>
      }
    >
      <div className={`ui-field${invalid || error ? ' ui-field-invalid' : ''}`}>
        <label className="ui-field-label" htmlFor="profile-username">
          {t('profilePage.usernameLabel')}
        </label>

        {/* The group runs left-to-right as a unit, so the @ sits where
            the name starts rather than at the far end of an RTL row. */}
        <div className="ui-input-group ep-username-group">
          <span className="ep-username-at" aria-hidden="true">
            @
          </span>
          <input
            id="profile-username"
            className="ui-input ep-username-input"
            value={draft}
            onChange={(event) => {
              setDraft(event.target.value)
              onErrorCleared()
            }}
            // A username is never Persian, so the keyboard and the
            // autocorrect should not behave as though it might be.
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            aria-invalid={invalid || !!error || undefined}
            autoFocus
          />
        </div>

        {invalid ? (
          <span className="ui-field-error">{t('profilePage.usernameInvalidChars')}</span>
        ) : error ? (
          <span className="ui-field-error">{error}</span>
        ) : (
          <span className="ui-field-help">
            {clearing ? t('profilePage.usernameRemoveHint') : t('profilePage.usernameHint')}
          </span>
        )}
      </div>
    </Sheet>
  )
}
