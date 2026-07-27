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
import { formatDateTime, formatRawAmount, shortAddress } from '@/lib/format';
import { ensureGiwaWalletClient, sendWalletTransaction } from '@/lib/wallet';
import { ErrorState, LoadingState } from './async-state';
import { StatusBadge } from './status-badge';

type RefundPhase = 'idle' | 'preparing' | 'approving' | 'refunding' | 'verifying';

export function RefundsPanel() {
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
    idle: 'Fund & submit refund',
    preparing: 'Preparing refund calldata…',
    approving: 'Approve settlement token…',
    refunding: 'Submit refund in wallet…',
    verifying: 'Waiting for chain verification…',
  };

  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Refunds</h1>
          <p>Full or partial refunds are funded directly by the merchant wallet.</p>
        </div>
      </div>

      <div className="info-banner" style={{ marginBottom: 20 }}>
        <ShieldCheck size={17} />
        <span>
          Only chain-verified payments can be refunded. GiwaPay does not hold a refund balance; the
          merchant approves the settlement token and sends the onchain refund.
        </span>
      </div>

      <Card className="panel" style={{ marginBottom: 20 }}>
        <div className="panel-header">
          <h2>Initiate merchant-funded refund</h2>
        </div>
        <form className="panel-body" onSubmit={submit}>
          <div className="form-grid">
            <Field label="Verified payment" htmlFor="refund-payment" className="full">
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
                <option value="">Select a payment</option>
                {refundable.map((intent) => {
                  const metadata = getConfiguredToken(intent.settlement.token);
                  return (
                    <option value={intent.id} key={intent.id}>
                      {intent.description} ·{' '}
                      {formatRawAmount(
                        BigInt(intent.settlement.amount).toString(),
                        metadata?.decimals ?? 18,
                      )}{' '}
                      {metadata?.symbol ?? shortAddress(intent.settlement.token)}
                    </option>
                  );
                })}
              </Select>
            </Field>
            <Field
              label="Refund amount"
              htmlFor="refund-amount"
              hint={
                selected
                  ? `Remaining: ${formatRawAmount(
                      (
                        BigInt(selected.settlement.amount) - BigInt(selected.refundedAmount)
                      ).toString(),
                      token?.decimals ?? 18,
                    )} ${token?.symbol ?? ''}`
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
            <Field label="Reason (optional)" htmlFor="refund-reason">
              <Input
                id="refund-reason"
                value={reason}
                onChange={(event) => {
                  setReason(event.target.value);
                  setRefundIdempotencyKey(undefined);
                }}
                maxLength={500}
                placeholder="Customer request"
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
                      Resume the same refund
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
                ? 'Switch to GIWA & refund'
                : phaseLabel[phase]}
            </Button>
          </div>
        </form>
      </Card>

      <Card className="panel">
        <div className="panel-header">
          <h2>Refundable payments</h2>
        </div>
        {intents.isLoading ? (
          <LoadingState />
        ) : intents.error ? (
          <div className="panel-body">
            <ErrorState error={intents.error} />
          </div>
        ) : refundable.length ? (
          <table className="data-table">
            <thead>
              <tr>
                <th>Payment</th>
                <th>Verified settlement</th>
                <th>Refunded</th>
                <th>Status</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {refundable.map((intent) => {
                const metadata = getConfiguredToken(intent.settlement.token);
                return (
                  <tr key={intent.id}>
                    <td>
                      <span className="table-primary">{intent.description}</span>
                      <span className="table-secondary">{intent.id}</span>
                    </td>
                    <td>
                      {formatRawAmount(intent.settlement.amount, metadata?.decimals ?? 18)}{' '}
                      {metadata?.symbol ?? ''}
                    </td>
                    <td>
                      {formatRawAmount(intent.refundedAmount, metadata?.decimals ?? 18)}{' '}
                      {metadata?.symbol ?? ''}
                    </td>
                    <td>
                      <StatusBadge status={intent.status} />
                    </td>
                    <td>{formatDateTime(intent.createdAt)}</td>
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
            <h3>No refundable payments</h3>
            <p>Verified successful payments will appear here.</p>
          </div>
        )}
      </Card>
    </>
  );
}
