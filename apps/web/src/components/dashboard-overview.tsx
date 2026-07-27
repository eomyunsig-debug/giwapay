'use client';

import { ArrowUpRight, Link2, ReceiptText } from 'lucide-react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Card } from '@giwapay/ui';

import { giwaPayClient } from '@/lib/api';
import { getConfiguredToken } from '@/lib/config';
import { formatDateTime, formatRawAmount, shortAddress } from '@/lib/format';
import { ErrorState, LoadingState } from './async-state';
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
          <h1>{merchant.data?.displayName ?? 'Merchant overview'}</h1>
          <p>The latest 50 records below come from the chain-indexed database.</p>
        </div>
        <Link className="action-link action-link--primary" href="/dashboard/payment-links">
          <Link2 size={15} /> Create payment link
        </Link>
      </div>

      <div className="metric-grid">
        <Card className="metric-card">
          <span className="metric-label">Verified · latest 50</span>
          <strong className="metric-value">{paid.length}</strong>
          <span className="metric-caption">Indexer-confirmed success events</span>
        </Card>
        <Card className="metric-card">
          <span className="metric-label">Awaiting · latest 50</span>
          <strong className="metric-value">{awaiting.length}</strong>
          <span className="metric-caption">Created, submitted, or confirming</span>
        </Card>
        <Card className="metric-card">
          <span className="metric-label">Refunded · latest 50</span>
          <strong className="metric-value">{refundCount}</strong>
          <span className="metric-caption">Merchant-funded onchain refunds</span>
        </Card>
      </div>

      <Card className="panel">
        <div className="panel-header">
          <h2>Recent payment intents</h2>
          <span className="metric-caption">Auto-refreshes from API</span>
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
          <table className="data-table">
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
                    <span className="table-secondary">{intent.id}</span>
                  </td>
                  <td>
                    {formatRawAmount(
                      intent.settlement.amount,
                      getConfiguredToken(intent.settlement.token)?.decimals ?? 18,
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
