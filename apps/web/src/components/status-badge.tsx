import { Badge } from '@giwapay/ui';
import type { PaymentStatus } from '@giwapay/sdk';
import { Bilingual } from './bilingual';

const statusConfig: Record<
  PaymentStatus,
  { ko: string; en: string; tone: 'neutral' | 'info' | 'success' | 'warning' | 'danger' }
> = {
  created: { ko: '결제 대기', en: 'Awaiting payment', tone: 'info' },
  submitted: { ko: '온체인 검증 중', en: 'Verifying onchain', tone: 'warning' },
  succeeded: { ko: '결제 완료', en: 'Paid', tone: 'success' },
  expired: { ko: '만료', en: 'Expired', tone: 'neutral' },
  partially_refunded: { ko: '일부 환불', en: 'Partially refunded', tone: 'warning' },
  refunded: { ko: '환불 완료', en: 'Refunded', tone: 'success' },
};

export function StatusBadge({ status }: { status: PaymentStatus }) {
  const config = statusConfig[status];
  return (
    <Badge tone={config.tone}>
      <span className={`status-dot status-dot--${config.tone}`} />
      <Bilingual ko={config.ko} en={config.en} />
    </Badge>
  );
}
