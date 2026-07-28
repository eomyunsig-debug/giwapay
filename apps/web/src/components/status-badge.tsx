import { Badge } from '@giwapay/ui';
import type { PaymentStatus } from '@giwapay/sdk';

const statusConfig: Record<
  PaymentStatus,
  { label: string; tone: 'neutral' | 'info' | 'success' | 'warning' | 'danger' }
> = {
  created: { label: 'Awaiting payment', tone: 'info' },
  submitted: { label: 'Verifying onchain', tone: 'warning' },
  succeeded: { label: 'Paid', tone: 'success' },
  expired: { label: 'Expired', tone: 'neutral' },
  partially_refunded: { label: 'Partially refunded', tone: 'warning' },
  refunded: { label: 'Refunded', tone: 'success' },
};

export function StatusBadge({ status }: { status: PaymentStatus }) {
  const config = statusConfig[status];
  return (
    <Badge tone={config.tone}>
      <span className={`status-dot status-dot--${config.tone}`} />
      {config.label}
    </Badge>
  );
}
