'use client';

import { Check, Clock3, ExternalLink, ReceiptText, RotateCcw, ShieldCheck } from 'lucide-react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';

import { DefinitionRow } from '@giwapay/ui';
import { giwaPayClient } from '@/lib/api';
import { getConfiguredToken } from '@/lib/config';
import { formatDateTime, formatRawAmount, shortAddress } from '@/lib/format';
import { AsyncReceiptFrame } from './receipt-frame';
import { ErrorState, LoadingState } from './async-state';
import { StatusBadge } from './status-badge';

export function ReceiptClient({ id }: { id: string }) {
  const detail = useQuery({
    queryKey: ['receipt', id],
    queryFn: () => giwaPayClient.getPaymentIntent(id),
    refetchInterval: (query) =>
      ['created', 'submitted'].includes(query.state.data?.paymentIntent.status ?? '')
        ? 2_000
        : false,
  });

  if (detail.isLoading) {
    return (
      <AsyncReceiptFrame>
        <LoadingState label="Loading verified receipt…" />
      </AsyncReceiptFrame>
    );
  }
  if (detail.error || !detail.data) {
    return (
      <AsyncReceiptFrame>
        <ErrorState
          title="Receipt unavailable"
          error={detail.error ?? new Error('Receipt not found')}
        />
      </AsyncReceiptFrame>
    );
  }

  const { paymentIntent: intent, refunds } = detail.data;
  const token = getConfiguredToken(intent.settlement.token);
  const inputToken = intent.payment?.inputToken
    ? getConfiguredToken(intent.payment.inputToken)
    : undefined;
  const verified = Boolean(intent.payment?.verifiedAt);
  const explorerUrl = intent.payment?.explorerUrl ?? undefined;

  return (
    <AsyncReceiptFrame>
      <div className="receipt-heading">
        <span className="receipt-status-icon">
          {verified ? <Check size={25} /> : <Clock3 size={24} />}
        </span>
        <h1>{verified ? 'Payment verified' : 'Awaiting chain verification'}</h1>
        <p>
          {verified
            ? 'The backend independently matched the canonical PaymentSucceeded event.'
            : 'A submitted transaction is not treated as a successful payment.'}
        </p>
      </div>

      <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 15 }}>
        <StatusBadge status={intent.status} />
      </div>

      <dl>
        <DefinitionRow term="Merchant">
          {intent.merchant?.name ?? 'Verified merchant'}
        </DefinitionRow>
        <DefinitionRow term="Description">{intent.description}</DefinitionRow>
        <DefinitionRow term="Exact settlement">
          {formatRawAmount(intent.settlement.amount, token?.decimals ?? 18)}{' '}
          {token?.symbol ?? shortAddress(intent.settlement.token)}
        </DefinitionRow>
        <DefinitionRow term="Settlement token">
          <span className="mono">{intent.settlement.token}</span>
        </DefinitionRow>
        <DefinitionRow term="Input paid">
          {intent.payment?.inputAmount && intent.payment.inputToken ? (
            <span>
              {formatRawAmount(intent.payment.inputAmount, inputToken?.decimals ?? 18)}{' '}
              {inputToken?.symbol ?? 'token'}
              <br />
              <span className="mono">{intent.payment.inputToken}</span>
            </span>
          ) : (
            '—'
          )}
        </DefinitionRow>
        <DefinitionRow term="Platform fee">
          {formatRawAmount(intent.platformFee, token?.decimals ?? 18)}{' '}
          {token?.symbol ?? shortAddress(intent.settlement.token)}
        </DefinitionRow>
        <DefinitionRow term="Payment ID">
          <span className="mono">{intent.paymentId}</span>
        </DefinitionRow>
        <DefinitionRow term="Paid from">
          <span className="mono">{intent.payment?.payer ?? '—'}</span>
        </DefinitionRow>
        <DefinitionRow term="Verified at">
          {intent.payment?.verifiedAt
            ? formatDateTime(intent.payment.verifiedAt)
            : 'Not verified yet'}
        </DefinitionRow>
        <DefinitionRow term="Transaction">
          {explorerUrl ? (
            <a className="explorer-link" href={explorerUrl} target="_blank" rel="noreferrer">
              <span className="mono">{intent.payment?.transactionHash}</span>{' '}
              <ExternalLink size={11} />
            </a>
          ) : intent.payment?.transactionHash ? (
            <span className="mono">
              Local Anvil transaction {shortAddress(intent.payment.transactionHash)}
            </span>
          ) : (
            '—'
          )}
        </DefinitionRow>
      </dl>

      {verified ? (
        <section style={{ marginTop: 24 }}>
          <h2 style={{ fontSize: 14 }}>
            <ShieldCheck size={15} style={{ verticalAlign: '-2px' }} /> Verified settlement
            distribution
          </h2>
          {intent.settlementRecipients.map((recipient) => (
            <div className="step-row" key={recipient.address}>
              <span className="step-number">
                <Check size={13} />
              </span>
              <span>
                <strong className="mono">{recipient.address}</strong>
                <small>
                  {recipient.amount
                    ? `${formatRawAmount(recipient.amount, token?.decimals ?? 18)} ${
                        token?.symbol ?? shortAddress(intent.settlement.token)
                      } received`
                    : `${(recipient.basisPoints / 100).toFixed(2)}% split`}
                </small>
              </span>
            </div>
          ))}
        </section>
      ) : null}

      {refunds.length > 0 ? (
        <section style={{ marginTop: 24 }}>
          <h2 style={{ fontSize: 14 }}>
            <RotateCcw size={15} style={{ verticalAlign: '-2px' }} /> Refunds
          </h2>
          {refunds.map((refund) => (
            <div className="step-row" key={refund.id}>
              <span className="step-number">
                {refund.status === 'succeeded' ? <Check size={13} /> : <Clock3 size={13} />}
              </span>
              <span>
                <strong>
                  {formatRawAmount(refund.amount, token?.decimals ?? 18)} {token?.symbol ?? ''}
                </strong>
                <small>
                  {refund.status === 'succeeded'
                    ? `Verified ${refund.verifiedAt ? formatDateTime(refund.verifiedAt) : ''}`
                    : 'Awaiting independent verification'}
                </small>
              </span>
              {refund.transactionHash && refund.explorerUrl ? (
                <a
                  className="explorer-link"
                  href={refund.explorerUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  <ExternalLink size={13} />
                </a>
              ) : refund.transactionHash ? (
                <span className="mono">
                  Local Anvil transaction {shortAddress(refund.transactionHash)}
                </span>
              ) : null}
            </div>
          ))}
        </section>
      ) : null}

      <div className="info-banner success-banner" style={{ marginTop: 22 }}>
        {verified ? <ShieldCheck size={16} /> : <ReceiptText size={16} />}
        <span>
          Receipt data is loaded from GiwaPay&apos;s chain-indexed database. It is not a client-only
          success state.
        </span>
      </div>
      <div className="form-actions">
        {!verified ? (
          <Link
            className="gp-button gp-button--secondary"
            href={`/checkout/${encodeURIComponent(intent.id)}`}
          >
            Return to checkout
          </Link>
        ) : null}
      </div>
    </AsyncReceiptFrame>
  );
}
