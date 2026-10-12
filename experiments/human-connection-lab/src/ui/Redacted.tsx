/**
 * Text that exists but isn't yours to read yet, drawn as ink bars.
 *
 * The pattern is fixed: it never reflects the hidden text's length, because
 * length leaks effort and invites comparison before anything is opened.
 */
export function Redacted({ label = 'Sealed — opens when both halves are in' }: { label?: string }) {
  return (
    <div className="redacted" role="img" aria-label={label}>
      <span className="redacted__bar" />
      <span className="redacted__bar" />
      <span className="redacted__bar" />
    </div>
  );
}
