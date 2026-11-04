import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";

const controlBase =
  "block min-h-11 w-full rounded-lg border bg-surface px-3 py-2 text-base text-foreground placeholder:text-slate-400 " +
  "disabled:bg-slate-100";

function controlClass(error?: string): string {
  return `${controlBase} ${error ? "border-danger" : "border-border"}`;
}

interface FieldProps {
  id: string;
  label: string;
  required?: boolean;
  error?: string;
  hint?: string;
  children: ReactNode;
}

/** Label + control + hint + error message, wired for screen readers. */
export function Field({ id, label, required, error, hint, children }: FieldProps) {
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="block text-sm font-medium text-foreground">
        {label}
        {required ? <span className="text-danger" aria-hidden="true"> *</span> : null}
        {required ? <span className="sr-only"> (required)</span> : null}
      </label>
      {children}
      {hint && !error ? (
        <p id={`${id}-hint`} className="text-sm text-muted">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={`${id}-error`} role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function describedBy(id: string, error?: string, hint?: string): string | undefined {
  if (error) return `${id}-error`;
  if (hint) return `${id}-hint`;
  return undefined;
}

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  id: string;
  label: string;
  error?: string;
  hint?: string;
}

export function TextInput({ id, label, error, hint, required, className = "", ...rest }: InputProps) {
  return (
    <Field id={id} label={label} required={required} error={error} hint={hint}>
      <input
        {...rest}
        id={id}
        dir={rest.dir ?? "auto"}
        required={required}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, error, hint)}
        className={`${controlClass(error)} ${className}`}
      />
    </Field>
  );
}

interface TextAreaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  id: string;
  label: string;
  error?: string;
  hint?: string;
}

export function TextArea({ id, label, error, hint, required, className = "", ...rest }: TextAreaProps) {
  return (
    <Field id={id} label={label} required={required} error={error} hint={hint}>
      <textarea
        {...rest}
        id={id}
        dir={rest.dir ?? "auto"}
        rows={rest.rows ?? 3}
        required={required}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, error, hint)}
        className={`${controlClass(error)} ${className}`}
      />
    </Field>
  );
}

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  id: string;
  label: string;
  error?: string;
  hint?: string;
}

export function Select({ id, label, error, hint, required, className = "", children, ...rest }: SelectProps) {
  return (
    <Field id={id} label={label} required={required} error={error} hint={hint}>
      <select
        {...rest}
        id={id}
        required={required}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, error, hint)}
        className={`${controlClass(error)} ${className}`}
      >
        {children}
      </select>
    </Field>
  );
}
