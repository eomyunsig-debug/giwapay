import {
  forwardRef,
  useId,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type InputHTMLAttributes,
  type LabelHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
} from 'react';

const cx = (...values: Array<string | false | null | undefined>): string =>
  values.filter(Boolean).join(' ');

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    className,
    variant = 'primary',
    size = 'md',
    loading = false,
    disabled,
    children,
    type = 'button',
    ...props
  },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cx('gp-button', `gp-button--${variant}`, `gp-button--${size}`, className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading ? <span className="gp-spinner" aria-hidden="true" /> : null}
      <span>{children}</span>
    </button>
  );
});

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>): ReactNode {
  return <div className={cx('gp-card', className)} {...props} />;
}

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: 'neutral' | 'info' | 'success' | 'warning' | 'danger';
}

export function Badge({ className, tone = 'neutral', ...props }: BadgeProps): ReactNode {
  return <span className={cx('gp-badge', `gp-badge--${tone}`, className)} {...props} />;
}

export interface FieldProps {
  label: string;
  hint?: string;
  error?: string;
  children: ReactNode;
  htmlFor?: string;
  className?: string;
}

export function Field({ label, hint, error, children, htmlFor, className }: FieldProps): ReactNode {
  const fallbackId = useId();
  const descriptionId = `${htmlFor ?? fallbackId}-description`;
  return (
    <div className={cx('gp-field', className)}>
      <label className="gp-label" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
      {error ? (
        <p id={descriptionId} className="gp-field-error" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p id={descriptionId} className="gp-field-hint">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...props }, ref) {
    return <input ref={ref} className={cx('gp-input', className)} {...props} />;
  },
);

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  function Select({ className, ...props }, ref) {
    return <select ref={ref} className={cx('gp-select', className)} {...props} />;
  },
);

export function Divider({ className, ...props }: HTMLAttributes<HTMLHRElement>) {
  return <hr className={cx('gp-divider', className)} {...props} />;
}

export function ScreenReaderOnly({ className, ...props }: HTMLAttributes<HTMLSpanElement>) {
  return <span className={cx('gp-sr-only', className)} {...props} />;
}

export function Skeleton({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cx('gp-skeleton', className)} aria-hidden="true" {...props} />;
}

export function DefinitionRow({
  term,
  children,
  className,
}: {
  term: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cx('gp-definition-row', className)}>
      <dt>{term}</dt>
      <dd>{children}</dd>
    </div>
  );
}

export function Label({ className, ...props }: LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cx('gp-label', className)} {...props} />;
}

export { cx };
