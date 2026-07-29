'use client';

import { ArrowUpRight, Link2, ReceiptText } from 'lucide-react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Card } from '@giwapay/ui';

import { giwaPayClient } from '@/lib/api';
import { getConfiguredToken } from '@/lib/config';
import { formatConfiguredAmount, formatDateTime, shortAddress } from '@/lib/format';
import { ErrorState, LoadingState } from './async-state';
import { Bilingual } from './bilingual';
import { StatusBadge } from './status-badge';

export function DashboardOverview() {
  const intents = useQuery({
    queryKey: ['dashboard', 'payment-intents'],
    queryFn: () => giwaPayClient.listPaymentIntents(0, 50),
    refetchInterval: 5_000,
  });
  const merchant = useQuery({
    queryKey: ['dashboard', 'merchant'],
    queryFn: () => giwaPayClient.getMerchant(),
  });

  if (intents.isLoading || merchant.isLoading) {
    return <LoadingState label="Loading verified payment data…" />;
  }
  if (intents.error || merchant.error) {
    return (
      <ErrorState
        title="Dashboard data is unavailable"
        error={intents.error ?? merchant.error}
        action={
          <Link className="explorer-link" href="/login">
            Sign in again <ArrowUpRight size={12} />
          </Link>
        }
      />
    );
  }

  const items = intents.data?.data ?? [];
  const paid = items.filter(
    (intent) =>
      intent.status === 'succeeded' ||
      intent.status === 'partially_refunded' ||
      intent.status === 'refunded',
  );
  const awaiting = items.filter((intent) => ['created', 'submitted'].includes(intent.status));
  const refundCount = items.filter((intent) => BigInt(intent.refundedAmount) > 0n).length;

  return (
    <>
      <div className="page-heading">
        <div>
          <h1>
            {merchant.data?.displayName ?? <Bilingual ko="판매자 개요" en="Merchant overview" />}
          </h1>
          <Bilingual
            as="div"
            ko="온체인 검증이 끝난 결제 상태만 표시합니다."
            en="Only chain-verified payment state is shown here."
          />
        </div>
        <Link className="action-link action-link--primary" href="/dashboard/payment-links">
          <Link2 size={15} /> <Bilingual ko="결제 링크 만들기" en="Create payment link" />
        </Link>
      </div>

      <div className="metric-grid">
        <Card className="metric-card">
          <span className="metric-label">
            <Bilingual ko="검증 완료" en="Verified" />
          </span>
          <strong className="metric-value">{paid.length}</strong>
        </Card>
        <Card className="metric-card">
          <span className="metric-label">
            <Bilingual ko="진행 중" en="In progress" />
          </span>
          <strong className="metric-value">{awaiting.length}</strong>
        </Card>
        <Card className="metric-card">
          <span className="metric-label">
            <Bilingual ko="환불 포함" en="With refunds" />
          </span>
          <strong className="metric-value">{refundCount}</strong>
        </Card>
      </div>

      <Card className="panel">
        <div className="panel-header">
          <h2>
            <Bilingual ko="최근 결제 요청" en="Recent payment intents" />
          </h2>
        </div>
        {items.length === 0 ? (
          <div className="empty-state">
            <span className="empty-icon">
              <ReceiptText size={19} />
            </span>
            <h3>No payment intents yet</h3>
            <p>Create one from the dashboard or use the authenticated REST API.</p>
            <Link className="action-link" href="/dashboard/payment-links">
              Create your first link
            </Link>
          </div>
        ) : (
          <table className="data-table compact-table">
            <thead>
              <tr>
                <th>Description</th>
                <th>Settlement</th>
                <th>Status</th>
                <th>Created</th>
                <th aria-label="Open" />
              </tr>
            </thead>
            <tbody>
              {items.slice(0, 12).map((intent) => (
                <tr key={intent.id}>
                  <td>
                    <span className="table-primary">{intent.description}</span>
                  </td>
                  <td>
                    {formatConfiguredAmount(
                      intent.settlement.amount,
                      getConfiguredToken(intent.settlement.token),
                    )}{' '}
                    {getConfiguredToken(intent.settlement.token)?.symbol ??
                      shortAddress(intent.settlement.token)}
                  </td>
                  <td>
                    <StatusBadge status={intent.status} />
                  </td>
                  <td>{formatDateTime(intent.createdAt)}</td>
                  <td>
                    <Link
                      className="explorer-link"
                      href={`/receipt/${encodeURIComponent(intent.id)}`}
                      aria-label={`Open ${intent.description}`}
                    >
                      <ArrowUpRight size={14} />
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </>
  );
}
