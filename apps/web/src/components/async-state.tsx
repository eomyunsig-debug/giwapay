import { AlertTriangle, LoaderCircle } from 'lucide-react';
import type { ReactNode } from 'react';

export function LoadingState({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="async-state" role="status">
      <LoaderCircle className="spin" size={22} />
      <span>{label}</span>
    </div>
  );
}

export function ErrorState({
  title = 'Unable to load data',
  error,
  action,
}: {
  title?: string;
  error: unknown;
  action?: ReactNode;
}) {
  return (
    <div className="error-state" role="alert">
      <span className="error-icon">
        <AlertTriangle size={19} />
      </span>
      <div>
        <strong>{title}</strong>
        <p>{error instanceof Error ? error.message : 'Unknown error'}</p>
        {action}
      </div>
    </div>
  );
}
