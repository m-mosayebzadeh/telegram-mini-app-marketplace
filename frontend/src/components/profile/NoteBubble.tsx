import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { apiFetch, formatApiError } from '../../lib/api'
import { Sheet } from '../ui/Sheet'
import { Button } from '../ui/Button'

/** The same limit as the server (app/profile/note.py). */
export const MAX_NOTE = 60

export function saveNote(text: string): Promise<{ note: string | null }> {
  return apiFetch<{ note: string | null }>('/profile/me/note', {
    method: 'PUT',
    body: JSON.stringify({ text }),
  })
}

/**
 * The note of the day under a name (section 32, step 4), in place of the
 * bio: like Instagram's notes, how somebody is today, for a day.
 *
 * On somebody else's profile it shows only when there is one; no note,
 * nothing (the owner's decision). On your own, an empty one invites you
 * to write, and tapping either kind opens the editor.
 */
export function NoteBubble({
  note,
  isOwn,
  onSaved,
}: {
  note: string | null | undefined
  isOwn: boolean
  onSaved: () => void
}) {
  const { t, i18n } = useTranslation()
  const [open, setOpen] = useState(false)
  const [text, setText] = useState(note ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  if (!isOwn) {
    return note ? (
      <p className="pf-note" dir="auto">
        {note}
      </p>
    ) : null
  }

  async function save(value: string) {
    setBusy(true)
    setError('')
    try {
      await saveNote(value)
      setOpen(false)
      onSaved()
    } catch (err) {
      setError(formatApiError(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <button
        type="button"
        className={`pf-note pf-note-own${note ? '' : ' is-empty'}`}
        dir={note ? 'auto' : undefined}
        onClick={() => {
          setText(note ?? '')
          setOpen(true)
        }}
      >
        {note ?? t('note.add')}
      </button>

      {open && (
        <Sheet title={t('note.title')} onClose={() => setOpen(false)}>
          <div className="co-form">
            <label className="ui-field" htmlFor="note-text">
              <span className="ui-field-label">
                {t('note.label')}
                <span className="ui-field-counter">
                  {text.length.toLocaleString(i18n.language)} / {MAX_NOTE.toLocaleString(i18n.language)}
                </span>
              </span>
              <input
                id="note-text"
                className="ui-input"
                value={text}
                maxLength={MAX_NOTE}
                placeholder={t('note.placeholder')}
                onChange={(event) => setText(event.target.value)}
              />
              <span className="ui-field-help">{t('note.hint')}</span>
            </label>
            {error !== '' && <p className="ui-field-error">{error}</p>}
            <Button variant="primary" size="lg" block disabled={text.trim() === ''} loading={busy} onClick={() => void save(text)}>
              {t('note.save')}
            </Button>
            {note && (
              <Button variant="ghost" size="lg" block disabled={busy} onClick={() => void save('')}>
                {t('note.remove')}
              </Button>
            )}
          </div>
        </Sheet>
      )}
    </>
  )
}
