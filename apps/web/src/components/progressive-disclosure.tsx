import { ChevronDown } from 'lucide-react';
import type { ReactNode } from 'react';

export function ProgressiveDisclosure({
  summary,
  description,
  children,
  className,
}: {
  summary: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <details className={['gp-disclosure', className].filter(Boolean).join(' ')}>
      <summary>
        <span>
          <strong>{summary}</strong>
          {description ? <small>{description}</small> : null}
        </span>
        <ChevronDown size={17} aria-hidden="true" />
      </summary>
      <div className="gp-disclosure-content">{children}</div>
    </details>
  );
}
