/**
 * Where a person writes their half.
 *
 * It tells the writer, before they commit, the two things that matter: the
 * other half opens only when theirs is written too, and a sealed half can't
 * be edited. The seal button wakes up only once the half is long enough.
 */

import { useId, useState } from 'react';
import { MAX_HALF_LENGTH, MIN_HALF_LENGTH } from '../domain/world';

interface Props {
  label: string;
  hint: string;
  placeholder?: string;
  onSeal: (text: string) => boolean;
  /** Lifted paper on the daily page; flat inside an exchange's half. */
  variant?: 'lifted' | 'inline';
  autoFocus?: boolean;
}

export function Composer({ label, hint, placeholder = 'Write your half…', onSeal, variant = 'lifted', autoFocus }: Props) {
  const [text, setText] = useState('');
  const id = useId();
  const length = text.trim().length;
  const missing = Math.max(0, MIN_HALF_LENGTH - length);
  const ready = missing === 0 && length <= MAX_HALF_LENGTH;

  const status =
    length === 0
      ? hint
      : missing > 0
        ? `${missing} more character${missing === 1 ? '' : 's'} to seal`
        : length > MAX_HALF_LENGTH
          ? `${length - MAX_HALF_LENGTH} characters over the limit`
          : 'Ready to seal. Once sealed, it can’t be edited.';

  return (
    <form
      className={`composer composer--${variant}`}
      onSubmit={(e) => {
        e.preventDefault();
        if (ready && onSeal(text)) setText('');
      }}
    >
      <label className="composer__label" htmlFor={id}>
        {label}
      </label>
      <textarea
        id={id}
        className="composer__field"
        value={text}
        placeholder={placeholder}
        rows={4}
        maxLength={MAX_HALF_LENGTH + 200}
        autoFocus={autoFocus}
        aria-describedby={`${id}-status`}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          // Ctrl/⌘+Enter seals, for people on a keyboard; plain Enter is a new line.
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && ready) {
            e.preventDefault();
            if (onSeal(text)) setText('');
          }
        }}
      />
      <div className="composer__foot">
        <p className="composer__status" id={`${id}-status`} aria-live="polite">
          {status}
        </p>
        <button type="submit" className="btn btn--seal" disabled={!ready}>
          Seal my half
        </button>
      </div>
    </form>
  );
}
