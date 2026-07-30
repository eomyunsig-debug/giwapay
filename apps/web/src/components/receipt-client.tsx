'use client';

import { Check, Clock3, ExternalLink, RotateCcw, ShieldCheck } from 'lucide-react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';

import { DefinitionRow } from '@giwapay/ui';
import { giwaPayClient } from '@/lib/api';
import { getConfiguredToken } from '@/lib/config';
import { formatConfiguredAmount, formatDateTime, shortAddress } from '@/lib/format';
import { AsyncReceiptFrame } from './receipt-frame';
import { ErrorState, LoadingState } from './async-state';
import { useGiwaPayLocale } from './language-toggle';
import { ProgressiveDisclosure } from './progressive-disclosure';
import { StatusBadge } from './status-badge';

export function ReceiptClient({ id }: { id: string }) {
  const locale = useGiwaPayLocale();
  const ko = locale === 'ko';
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
        <LoadingState label={ko ? '검증된 영수증을 불러오는 중…' : 'Loading verified receipt…'} />
      </AsyncReceiptFrame>
    );
  }
  if (detail.error || !detail.data) {
    return (
      <AsyncReceiptFrame>
        <ErrorState
          title={ko ? '영수증을 열 수 없습니다' : 'Receipt unavailable'}
          error={detail.error ?? new Error(ko ? '영수증을 찾을 수 없습니다' : 'Receipt not found')}
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
        <h1>
          {verified
            ? ko
              ? '결제 검증 완료'
              : 'Payment verified'
            : ko
              ? '체인 검증 대기 중'
              : 'Awaiting chain verification'}
        </h1>
        <p>
          {verified
            ? ko
              ? '백엔드가 정규 PaymentSucceeded 이벤트를 독립적으로 대조했습니다.'
              : 'The backend independently matched the canonical PaymentSucceeded event.'
            : ko
              ? '제출된 거래만으로는 결제 성공으로 처리하지 않습니다.'
              : 'A submitted transaction is not treated as a successful payment.'}
        </p>
      </div>

      <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 15 }}>
        <StatusBadge status={intent.status} />
      </div>

      <dl>
        <DefinitionRow term={ko ? '판매자' : 'Merchant'}>
          {intent.merchant?.name ?? (ko ? '검증된 판매자' : 'Verified merchant')}
        </DefinitionRow>
        <DefinitionRow term={ko ? '설명' : 'Description'}>{intent.description}</DefinitionRow>
        <DefinitionRow term={ko ? '정확한 정산액' : 'Exact settlement'}>
          {formatConfiguredAmount(intent.settlement.amount, token)}{' '}
          {token?.symbol ?? shortAddress(intent.settlement.token)}
        </DefinitionRow>
        <DefinitionRow term={ko ? '지불한 입력액' : 'Input paid'}>
          {intent.payment?.inputAmount && intent.payment.inputToken ? (
            <span>
              {formatConfiguredAmount(intent.payment.inputAmount, inputToken)}{' '}
              {inputToken?.symbol ?? 'token'}
            </span>
          ) : (
            '—'
          )}
        </DefinitionRow>
        <DefinitionRow term={ko ? '플랫폼 수수료' : 'Platform fee'}>
          {formatConfiguredAmount(intent.platformFee, token)}{' '}
          {token?.symbol ?? shortAddress(intent.settlement.token)}
        </DefinitionRow>
        <DefinitionRow term={ko ? '거래' : 'Transaction'}>
          {explorerUrl ? (
            <a className="explorer-link" href={explorerUrl} target="_blank" rel="noreferrer">
              <span className="mono">{intent.payment?.transactionHash}</span>{' '}
              <ExternalLink size={11} />
            </a>
          ) : intent.payment?.transactionHash ? (
            <span className="mono">
              {ko ? '로컬 Anvil 거래' : 'Local Anvil transaction'}{' '}
              {shortAddress(intent.payment.transactionHash)}
            </span>
          ) : (
            '—'
          )}
        </DefinitionRow>
      </dl>

      <ProgressiveDisclosure
        summary={ko ? '영수증 세부정보 및 검증 방식' : 'Receipt details and verification'}
        description={
          ko
            ? '결제 ID, 지갑 주소, 토큰 주소와 정산 분배'
            : 'Payment ID, wallet and token addresses, and settlement distribution'
        }
      >
        <dl className="checkout-technical-terms">
          <DefinitionRow term={ko ? '정산 토큰' : 'Settlement token'}>
            <span className="mono">{intent.settlement.token}</span>
          </DefinitionRow>
          <DefinitionRow term={ko ? '입력 토큰' : 'Input token'}>
            <span className="mono">{intent.payment?.inputToken ?? '—'}</span>
          </DefinitionRow>
          <DefinitionRow term={ko ? '결제 ID' : 'Payment ID'}>
            <span className="mono">{intent.paymentId}</span>
          </DefinitionRow>
          <DefinitionRow term={ko ? '결제 지갑' : 'Paid from'}>
            <span className="mono">{intent.payment?.payer ?? '—'}</span>
          </DefinitionRow>
          <DefinitionRow term={ko ? '검증 시각' : 'Verified at'}>
            {intent.payment?.verifiedAt
              ? formatDateTime(intent.payment.verifiedAt, ko ? 'ko-KR' : 'en-US')
              : ko
                ? '아직 검증되지 않음'
                : 'Not verified yet'}
          </DefinitionRow>
        </dl>

        {verified ? (
          <section className="receipt-distribution">
            <h2>
              <ShieldCheck size={15} />{' '}
              {ko ? '검증된 정산 분배' : 'Verified settlement distribution'}
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
                      ? `${formatConfiguredAmount(recipient.amount, token)} ${
                          token?.symbol ?? shortAddress(intent.settlement.token)
                        } ${ko ? '수령' : 'received'}`
                      : `${(recipient.basisPoints / 100).toFixed(2)}% ${ko ? '분배' : 'split'}`}
                  </small>
                </span>
              </div>
            ))}
          </section>
        ) : null}

        <p className="disclosure-note">
          {ko
            ? '영수증은 체인 인덱싱 데이터베이스의 검증 결과이며, 클라이언트만의 성공 상태가 아닙니다.'
            : "This receipt comes from GiwaPay's chain-indexed verification, not a client-only success state."}
        </p>
      </ProgressiveDisclosure>

      {refunds.length > 0 ? (
        <section style={{ marginTop: 24 }}>
          <h2 style={{ fontSize: 14 }}>
            <RotateCcw size={15} style={{ verticalAlign: '-2px' }} /> {ko ? '환불' : 'Refunds'}
          </h2>
          {refunds.map((refund) => (
            <div className="step-row" key={refund.id}>
              <span className="step-number">
                {refund.status === 'succeeded' ? <Check size={13} /> : <Clock3 size={13} />}
              </span>
              <span>
                <strong>
                  {formatConfiguredAmount(refund.amount, token)} {token?.symbol ?? ''}
                </strong>
                <small>
                  {refund.status === 'succeeded'
                    ? `${ko ? '검증 완료' : 'Verified'} ${
                        refund.verifiedAt
                          ? formatDateTime(refund.verifiedAt, ko ? 'ko-KR' : 'en-US')
                          : ''
                      }`
                    : ko
                      ? '독립 검증 대기 중'
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
                  {ko ? '로컬 Anvil 거래' : 'Local Anvil transaction'}{' '}
                  {shortAddress(refund.transactionHash)}
                </span>
              ) : null}
            </div>
          ))}
        </section>
      ) : null}

      <div className="form-actions">
        {!verified ? (
          <Link
            className="gp-button gp-button--secondary"
            href={`/checkout/${encodeURIComponent(intent.id)}`}
          >
            {ko ? '결제 페이지로 돌아가기' : 'Return to checkout'}
          </Link>
        ) : null}
      </div>
    </AsyncReceiptFrame>
  );
}
