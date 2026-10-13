import { Children, ReactElement, ReactNode, cloneElement, useId } from 'react';

type Props = {
  label: string;
  /** The single form control (input/select/textarea/PasswordInput). It receives id + aria wiring. */
  children: ReactElement;
  hint?: ReactNode;
  error?: string | null;
  required?: boolean;
  /** Optional stable id (otherwise a generated one is used). */
  id?: string;
};

// Replaces the old "<div class=field><label>…</label><input/></div>" pattern, where the label was
// not programmatically tied to its control (so screen readers announced an unnamed field).
export default function FormField({ label, children, hint, error, required, id: idProp }: Props) {
  const generated = useId();
  const id = idProp ?? generated;
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const control = Children.only(children);
  const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(' ') || undefined;

  return (
    <div className={`field ${error ? 'has-error' : ''}`}>
      <label htmlFor={id}>
        {label}
        {required && (
          <span className="field-required" aria-hidden>
            {' '}
            *
          </span>
        )}
      </label>
      {cloneElement(control, {
        id,
        'aria-invalid': error ? true : undefined,
        'aria-describedby': describedBy,
        'aria-required': required || undefined,
      } as Record<string, unknown>)}
      {hint && (
        <p id={hintId} className="field-hint">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} className="field-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
