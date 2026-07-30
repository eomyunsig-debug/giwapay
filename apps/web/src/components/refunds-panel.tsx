'use client';

import { Check, ExternalLink, Info, RotateCcw, ShieldCheck } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { parseUnits, type Hex } from 'viem';
import { useAccount, usePublicClient, useSwitchChain, useWalletClient } from 'wagmi';

import { GIWA_SEPOLIA_CHAIN_ID } from '@giwapay/chains';
import { erc20ApprovalAbi, type RefundPreparation } from '@giwapay/sdk';
import { Button, Card, Field, Input, Select } from '@giwapay/ui';
import { giwaPayClient } from '@/lib/api';
import { getConfiguredToken, transactionExplorerUrl } from '@/lib/config';
import { formatConfiguredAmount, formatDateTime, shortAddress } from '@/lib/format';
import { ensureGiwaWalletClient, sendWalletTransaction } from '@/lib/wallet';
import { ErrorState, LoadingState } from './async-state';
import { Bilingual } from './bilingual';
import { useGiwaPayLocale } from './language-toggle';
import { ProgressiveDisclosure } from './progressive-disclosure';
import { StatusBadge } from './status-badge';

type RefundPhase = 'idle' | 'preparing' | 'approving' | 'refunding' | 'verifying';

export function RefundsPanel() {
  const ko = useGiwaPayLocale() === 'ko';
  const { address, chainId } = useAccount();
  const walletClientQuery = useWalletClient({
    chainId: GIWA_SEPOLIA_CHAIN_ID,
  });
  const walletClient = walletClientQuery.data;
  const publicClient = usePublicClient({ chainId: GIWA_SEPOLIA_CHAIN_ID });
  const { switchChainAsync } = useSwitchChain();
  const [intentId, setIntentId] = useState('');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [refundIdempotencyKey, setRefundIdempotencyKey] = useState<string>();
  const [phase, setPhase] = useState<RefundPhase>('idle');
  const [submittedHash, setSubmittedHash] = useState<Hex>();
  const [error, setError] = useState<string>();

  const intents = useQuery({
    queryKey: ['dashboard', 'payment-intents'],
    queryFn: () => giwaPayClient.listPaymentIntents(0, 100),
    refetchInterval: phase === 'verifying' ? 2_000 : false,
  });
  const detail = useQuery({
    queryKey: ['dashboard', 'refund-detail', intentId],
    queryFn: () => giwaPayClient.listMerchantRefunds(intentId),
    enabled: Boolean(intentId),
    refetchInterval: (query) =>
      query.state.data?.data.some((refund) => ['requested', 'submitted'].includes(refund.status))
        ? 2_000
        : false,
  });

  const refundable =
    intents.data?.data.filter((intent) =>
      ['succeeded', 'partially_refunded'].includes(intent.status),
    ) ?? [];
  const selected = refundable.find((intent) => intent.id === intentId);
  const token = selected ? getConfiguredToken(selected.settlement.token) : undefined;
  const requestedRefund = detail.data?.data.find((refund) =>
    ['requested', 'submitted'].includes(refund.status),
  );
  const pendingRefund = detail.data?.data.some((refund) =>
    ['requested', 'submitted'].includes(refund.status),
  );
  const submittedExplorerUrl = submittedHash ? transactionExplorerUrl(submittedHash) : undefined;

  const executePreparedRefund = async (prepared: RefundPreparation) => {
    if (!selected || !address || !publicClient) {
      throw new Error('The selected payment or connected merchant wallet is unavailable.');
    }
    const activeWalletClient = await ensureGiwaWalletClient({
      chainId,
      walletClient,
      switchChain: () => switchChainAsync({ chainId: GIWA_SEPOLIA_CHAIN_ID }),
      refreshWalletClient: async () => (await walletClientQuery.refetch()).data,
    });
    const rawAmount = BigInt(prepared.refund.amount);
    const allowance = await publicClient.readContract({
      address: selected.settlement.token,
      abi: erc20ApprovalAbi,
      functionName: 'allowance',
      args: [address, prepared.transaction.to],
    });
    if (allowance < rawAmount) {
      setPhase('approving');
      const approvalHash = await sendWalletTransaction(activeWalletClient, {
        account: address,
        to: prepared.approval.to,
        data: prepared.approval.data,
        value: BigInt(prepared.approval.value),
      });
      const approvalReceipt = await publicClient.waitForTransactionReceipt({
        hash: approvalHash,
        confirmations: 1,
      });
      if (approvalReceipt.status !== 'success') {
        throw new Error('Refund funding approval reverted.');
      }
    }

    setPhase('refunding');
    const refundHash = await sendWalletTransaction(activeWalletClient, {
      account: address,
      to: prepared.transaction.to,
      data: prepared.transaction.data,
      value: BigInt(prepared.transaction.value),
    });
    setSubmittedHash(refundHash);
    const receipt = await publicClient.waitForTransactionReceipt({
      hash: refundHash,
      confirmations: 1,
    });
    if (receipt.status !== 'success') {
      throw new Error('Refund transaction reverted.');
    }
    setPhase('verifying');
    await Promise.all([detail.refetch(), intents.refetch()]);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(undefined);
    if (!selected || !token || !address || !publicClient) {
      setError(
        'Select a refundable payment, configure its settlement token, and connect the merchant wallet.',
      );
      return;
    }
    setPhase('preparing');
    try {
      const rawAmount = parseUnits(amount, token.decimals);
      const remaining = BigInt(selected.settlement.amount) - BigInt(selected.refundedAmount);
      if (rawAmount <= 0n || rawAmount > remaining) {
        throw new Error('Refund must be greater than zero and not exceed the remaining amount.');
      }
      const prepared = await giwaPayClient.requestRefund(selected.id, {
        amount: rawAmount.toString(),
        ...(reason.trim() ? { reason: reason.trim() } : {}),
        idempotencyKey:
          refundIdempotencyKey ??
          (() => {
            const key = crypto.randomUUID();
            setRefundIdempotencyKey(key);
            return key;
          })(),
      });
      await executePreparedRefund(prepared);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Refund failed');
      setPhase('idle');
    }
  };

  const resumeRequestedRefund = async () => {
    if (!selected || !requestedRefund) return;
    setError(undefined);
    setPhase('preparing');
    try {
      const prepared = await giwaPayClient.resumeRefund(selected.id, requestedRefund.refundId);
      await executePreparedRefund(prepared);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Refund could not be resumed');
      setPhase('idle');
    }
  };

  const phaseLabel: Record<RefundPhase, string> = {
    idle: ko ? '자금 공급 후 환불' : 'Fund & submit refund',
    preparing: ko ? '환불 준비 중…' : 'Preparing refund calldata…',
    approving: ko ? '정산 토큰 승인…' : 'Approve settlement token…',
    refunding: ko ? '지갑에서 환불 제출…' : 'Submit refund in wallet…',
    verifying: ko ? '체인 검증 대기 중…' : 'Waiting for chain verification…',
  };

  return (
    <>
      <div className="page-heading">
        <div>
          <h1>
            <Bilingual ko="환불" en="Refunds" />
          </h1>
          <p>
            {ko
              ? '판매자 지갑에서 전액 또는 일부를 환불하세요.'
              : 'Send a full or partial refund from your merchant wallet.'}
          </p>
        </div>
      </div>

      <ProgressiveDisclosure
        className="refund-safety-disclosure"
        summary={<Bilingual ko="환불 자금 및 검증 방식" en="How refunds are funded and verified" />}
        description={
          <Bilingual
            ko="GiwaPay는 환불 잔액을 보관하지 않습니다."
            en="GiwaPay never holds a refund balance."
          />
        }
      >
        <div className="info-banner">
          <ShieldCheck size={17} />
          <span>
            {ko
              ? '체인에서 검증된 결제만 환불할 수 있습니다. 판매자가 정산 토큰을 승인하고 연결된 지갑에서 온체인 환불을 보냅니다.'
              : 'Only chain-verified payments can be refunded. The merchant approves the settlement token and sends the refund onchain from its connected wallet.'}
          </span>
        </div>
      </ProgressiveDisclosure>

      <Card className="panel" style={{ marginBottom: 20 }}>
        <div className="panel-header">
          <h2>
            <Bilingual ko="판매자 자금 환불 시작" en="Initiate merchant-funded refund" />
          </h2>
        </div>
        <form className="panel-body" onSubmit={submit}>
          <div className="form-grid">
            <Field
              label={ko ? '검증된 결제' : 'Verified payment'}
              htmlFor="refund-payment"
              className="full"
            >
              <Select
                id="refund-payment"
                value={intentId}
                onChange={(event) => {
                  setIntentId(event.target.value);
                  setAmount('');
                  setReason('');
                  setRefundIdempotencyKey(undefined);
                  setSubmittedHash(undefined);
                  setPhase('idle');
                }}
                required
              >
                <option value="">{ko ? '결제 선택' : 'Select a payment'}</option>
                {refundable.map((intent) => {
                  const metadata = getConfiguredToken(intent.settlement.token);
                  return (
                    <option value={intent.id} key={intent.id}>
                      {intent.description} ·{' '}
                      {formatConfiguredAmount(
                        BigInt(intent.settlement.amount).toString(),
                        metadata,
                      )}{' '}
                      {metadata?.symbol ?? shortAddress(intent.settlement.token)}
                    </option>
                  );
                })}
              </Select>
            </Field>
            <Field
              label={ko ? '환불 금액' : 'Refund amount'}
              htmlFor="refund-amount"
              hint={
                selected
                  ? `${ko ? '남은 금액' : 'Remaining'}: ${formatConfiguredAmount(
                      (
                        BigInt(selected.settlement.amount) - BigInt(selected.refundedAmount)
                      ).toString(),
                      token,
                    )} ${token?.symbol ?? ''}`
                  : ko
                    ? '먼저 검증된 결제를 선택하세요.'
                    : 'Choose a verified payment first.'
              }
            >
              <Input
                id="refund-amount"
                inputMode="decimal"
                value={amount}
                onChange={(event) => {
                  setAmount(event.target.value);
                  setRefundIdempotencyKey(undefined);
                }}
                placeholder="0.00"
                required
              />
            </Field>
            <Field label={ko ? '사유 (선택)' : 'Reason (optional)'} htmlFor="refund-reason">
              <Input
                id="refund-reason"
                value={reason}
                onChange={(event) => {
                  setReason(event.target.value);
                  setRefundIdempotencyKey(undefined);
                }}
                maxLength={500}
                placeholder={ko ? '고객 요청' : 'Customer request'}
              />
            </Field>
          </div>

          {pendingRefund ? (
            <div className="info-banner" style={{ marginTop: 14 }}>
              <Info size={15} />
              <span>
                One refund is already awaiting verification. A second request is blocked until it
                resolves.
                {requestedRefund ? (
                  <span className="form-actions" style={{ marginTop: 10 }}>
                    <Button
                      size="sm"
                      variant="secondary"
                      loading={phase !== 'idle'}
                      onClick={() => void resumeRequestedRefund()}
                    >
                      {ko ? '같은 환불 이어서 처리' : 'Resume the same refund'}
                    </Button>
                  </span>
                ) : null}
              </span>
            </div>
          ) : null}
          {submittedHash && phase === 'verifying' ? (
            <div className="info-banner" role="status" style={{ marginTop: 14 }}>
              <Info size={15} />
              <span>
                Refund transaction mined, but not yet marked successful.{' '}
                {submittedExplorerUrl ? (
                  <a
                    className="explorer-link"
                    href={submittedExplorerUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Explorer <ExternalLink size={11} />
                  </a>
                ) : (
                  <span className="mono">
                    Local Anvil transaction {shortAddress(submittedHash)}
                  </span>
                )}
              </span>
            </div>
          ) : null}
          {error ? (
            <p className="gp-field-error" role="alert">
              {error}
            </p>
          ) : null}
          <div className="form-actions">
            <Button
              type="submit"
              size="lg"
              loading={phase !== 'idle'}
              disabled={!selected || !token || !address || Boolean(pendingRefund)}
            >
              <RotateCcw size={15} />{' '}
              {phase === 'idle' && chainId !== GIWA_SEPOLIA_CHAIN_ID
                ? ko
                  ? 'GIWA로 전환 후 환불'
                  : 'Switch to GIWA & refund'
                : phaseLabel[phase]}
            </Button>
          </div>
        </form>
      </Card>

      <Card className="panel">
        <div className="panel-header">
          <h2>
            <Bilingual ko="환불 가능한 결제" en="Refundable payments" />
          </h2>
        </div>
        {intents.isLoading ? (
          <LoadingState />
        ) : intents.error ? (
          <div className="panel-body">
            <ErrorState error={intents.error} />
          </div>
        ) : refundable.length ? (
          <table className="data-table refund-table">
            <thead>
              <tr>
                <th>{ko ? '결제' : 'Payment'}</th>
                <th>{ko ? '검증된 정산' : 'Verified settlement'}</th>
                <th>{ko ? '환불됨' : 'Refunded'}</th>
                <th>{ko ? '상태' : 'Status'}</th>
              </tr>
            </thead>
            <tbody>
              {refundable.map((intent) => {
                const metadata = getConfiguredToken(intent.settlement.token);
                return (
                  <tr key={intent.id}>
                    <td>
                      <span className="table-primary">{intent.description}</span>
                      <ProgressiveDisclosure
                        className="refund-row-disclosure"
                        summary={ko ? '결제 상세' : 'Payment details'}
                        description={ko ? 'ID와 생성 시각' : 'ID and creation time'}
                      >
                        <dl>
                          <div className="gp-definition-row">
                            <dt>{ko ? '결제 ID' : 'Payment ID'}</dt>
                            <dd className="mono">{intent.id}</dd>
                          </div>
                          <div className="gp-definition-row">
                            <dt>{ko ? '생성' : 'Created'}</dt>
                            <dd>{formatDateTime(intent.createdAt)}</dd>
                          </div>
                        </dl>
                      </ProgressiveDisclosure>
                    </td>
                    <td>
                      {formatConfiguredAmount(intent.settlement.amount, metadata)}{' '}
                      {metadata?.symbol ?? ''}
                    </td>
                    <td>
                      {formatConfiguredAmount(intent.refundedAmount, metadata)}{' '}
                      {metadata?.symbol ?? ''}
                    </td>
                    <td>
                      <StatusBadge status={intent.status} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <div className="empty-state">
            <span className="empty-icon">
              <Check size={19} />
            </span>
            <h3>{ko ? '환불 가능한 결제가 없습니다' : 'No refundable payments'}</h3>
            <p>
              {ko
                ? '검증 완료된 결제가 여기에 표시됩니다.'
                : 'Verified successful payments will appear here.'}
            </p>
          </div>
        )}
      </Card>
    </>
  );
}
