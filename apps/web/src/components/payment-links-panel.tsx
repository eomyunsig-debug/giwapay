'use client';

import { Check, Copy, ExternalLink, Link2, Plus } from 'lucide-react';
import Link from 'next/link';
import { QRCodeSVG } from 'qrcode.react';
import { useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { formatUnits, parseUnits } from 'viem';

import type { CreatePaymentIntentResponse } from '@giwapay/sdk';
import { Button, Card, Field, Input, Select } from '@giwapay/ui';
import { giwaPayClient } from '@/lib/api';
import { DEFAULT_SPLIT_ID, getConfiguredToken } from '@/lib/config';
import { formatDateTime } from '@/lib/format';
import { ErrorState, LoadingState } from './async-state';
import { Bilingual } from './bilingual';
import { StatusBadge } from './status-badge';

const defaultExpiry = (): string => {
  const date = new Date(Date.now() + 30 * 60 * 1000);
  date.setSeconds(0, 0);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
};

export function PaymentLinksPanel() {
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [tokenAddress, setTokenAddress] = useState('');
  const [expiresAt, setExpiresAt] = useState(defaultExpiry);
  const [splitId, setSplitId] = useState<string>(DEFAULT_SPLIT_ID);
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<CreatePaymentIntentResponse>();
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string>();
  const intents = useQuery({
    queryKey: ['dashboard', 'payment-intents'],
    queryFn: () => giwaPayClient.listPaymentIntents(0, 25),
  });
  const methods = useQuery({
    queryKey: ['payment-methods'],
    queryFn: () => giwaPayClient.listPaymentMethods(),
  });

  const settlementTokens = [
    ...new Map(
      (methods.data?.data ?? []).map((method) => [
        method.settlementToken.address.toLowerCase(),
        method.settlementToken,
      ]),
    ).values(),
  ];
  const activeTokenAddress = tokenAddress || settlementTokens[0]?.address || '';
  const selectedToken = settlementTokens.find((token) => token.address === activeTokenAddress);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(undefined);
    if (!selectedToken) {
      setError('No verified settlement token deployment is configured for this environment.');
      return;
    }
    setCreating(true);
    try {
      const rawAmount = parseUnits(amount, selectedToken.decimals);
      if (rawAmount <= 0n) throw new Error('Amount must be greater than zero.');
      const response = await giwaPayClient.createPaymentIntent({
        idempotencyKey: crypto.randomUUID(),
        description,
        settlementToken: selectedToken.address,
        settlementAmount: rawAmount.toString(),
        splitId: splitId as `0x${string}`,
        expiresAt: new Date(expiresAt).toISOString(),
      });
      setCreated(response);
      setDescription('');
      setAmount('');
      await intents.refetch();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not create payment intent');
    } finally {
      setCreating(false);
    }
  };

  const copyLink = async () => {
    if (!created) return;
    await navigator.clipboard.writeText(created.checkoutUrl);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1_500);
  };

  return (
    <>
      <div className="page-heading">
        <div>
          <h1>
            <Bilingual ko="결제 링크" en="Payment links" />
          </h1>
          <Bilingual
            as="div"
            ko="서명된 결제 요청, 호스팅 결제 링크와 QR 코드를 만드세요."
            en="Create a signed PaymentIntent, hosted checkout link, and QR code."
          />
        </div>
      </div>

      <Card className="panel" style={{ marginBottom: 20 }}>
        <div className="panel-header">
          <h2>
            <Bilingual ko="결제 요청 만들기" en="Create payment intent" />
          </h2>
          <span className={`gp-badge gp-badge--${selectedToken?.testOnly ? 'warning' : 'info'}`}>
            {selectedToken?.testOnly ? 'Testnet demo' : 'GIWA Sepolia'}
          </span>
        </div>
        <form className="panel-body" onSubmit={submit}>
          {methods.isLoading ? (
            <LoadingState label="Loading supported settlement assets…" />
          ) : methods.error ? (
            <ErrorState title="Payment method registry unavailable" error={methods.error} />
          ) : settlementTokens.length === 0 ? (
            <div className="error-state" role="alert">
              <div>
                <strong>No settlement-enabled token configured</strong>
                <p>
                  The public payment-method registry did not return an asset that can be used as
                  exact merchant settlement.
                </p>
              </div>
            </div>
          ) : null}
          <div className="form-grid">
            <Field label="Product description" htmlFor="intent-description" className="full">
              <Input
                id="intent-description"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="Annual design toolkit"
                maxLength={500}
                required
              />
            </Field>
            <Field
              label="Exact settlement amount"
              htmlFor="settlement-amount"
              hint="The merchant receives this exact amount, excluding the separately disclosed platform fee."
            >
              <Input
                id="settlement-amount"
                inputMode="decimal"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                placeholder="48000"
                required
              />
            </Field>
            <Field label="Settlement token" htmlFor="settlement-token">
              <Select
                id="settlement-token"
                value={activeTokenAddress}
                onChange={(event) => setTokenAddress(event.target.value)}
                required
              >
                {settlementTokens.map((token) => (
                  <option value={token.address} key={token.address}>
                    {token.testOnly ? 'Testnet demo · ' : ''}
                    {token.name} ({token.symbol})
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Expires at" htmlFor="expires-at" className="full">
              <Input
                id="expires-at"
                type="datetime-local"
                value={expiresAt}
                min={defaultExpiry()}
                onChange={(event) => setExpiresAt(event.target.value)}
                required
              />
            </Field>
            <Field
              label="Registered settlement splitId"
              htmlFor="split-id"
              hint="Use zero for the default 100% payout, or copy an enabled immutable template from Settlement splits."
              className="full"
            >
              <Input
                id="split-id"
                className="mono"
                value={splitId}
                onChange={(event) => setSplitId(event.target.value)}
                pattern="^0x[a-fA-F0-9]{64}$"
                spellCheck={false}
                required
              />
              <Link className="explorer-link" href="/dashboard/splits">
                Manage registered splits
              </Link>
            </Field>
          </div>
          {error ? (
            <p className="gp-field-error" role="alert">
              {error}
            </p>
          ) : null}
          <div className="form-actions">
            <Button
              type="submit"
              size="lg"
              loading={creating}
              disabled={settlementTokens.length === 0 || methods.isLoading}
            >
              <Plus size={15} /> Create payment link
            </Button>
          </div>
        </form>
      </Card>

      {created ? (
        <div className="qr-result" role="status" style={{ marginBottom: 20 }}>
          <div className="qr-wrap">
            <QRCodeSVG
              value={created.checkoutUrl}
              size={126}
              level="M"
              marginSize={1}
              title="Hosted checkout QR code"
            />
          </div>
          <div>
            <span className="gp-badge gp-badge--success">
              <Check size={11} /> Signed intent created
            </span>
            <h3>Hosted checkout is ready</h3>
            <p className="link-value">{created.checkoutUrl}</p>
            <div className="inline-actions">
              <Button variant="secondary" size="sm" onClick={copyLink}>
                {copied ? <Check size={13} /> : <Copy size={13} />}
                {copied ? 'Copied' : 'Copy link'}
              </Button>
              <a
                className="gp-button gp-button--primary gp-button--sm"
                href={created.checkoutUrl}
                target="_blank"
                rel="noreferrer"
              >
                Open checkout <ExternalLink size={13} />
              </a>
            </div>
          </div>
        </div>
      ) : null}

      <Card className="panel">
        <div className="panel-header">
          <h2>
            <Bilingual ko="최근 링크" en="Recent links" />
          </h2>
        </div>
        {intents.isLoading ? (
          <LoadingState />
        ) : intents.error ? (
          <div className="panel-body">
            <ErrorState error={intents.error} />
          </div>
        ) : intents.data?.data.length ? (
          <table className="data-table">
            <thead>
              <tr>
                <th>Description</th>
                <th>Exact settlement</th>
                <th>Status</th>
                <th>Expires</th>
                <th aria-label="Checkout" />
              </tr>
            </thead>
            <tbody>
              {intents.data.data.map((intent) => {
                const token =
                  settlementTokens.find(
                    (candidate) =>
                      candidate.address.toLowerCase() === intent.settlement.token.toLowerCase(),
                  ) ?? getConfiguredToken(intent.settlement.token);
                return (
                  <tr key={intent.id}>
                    <td>
                      <span className="table-primary">{intent.description}</span>
                      <span className="table-secondary">{intent.id}</span>
                    </td>
                    <td>
                      {token
                        ? `${formatUnits(
                            BigInt(intent.settlement.amount),
                            token.decimals,
                          )} ${token.symbol}`
                        : intent.settlement.amount}
                    </td>
                    <td>
                      <StatusBadge status={intent.status} />
                    </td>
                    <td>{formatDateTime(intent.expiresAt)}</td>
                    <td>
                      <Link
                        className="explorer-link"
                        href={`/checkout/${encodeURIComponent(intent.id)}`}
                      >
                        <Link2 size={14} />
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <div className="empty-state">
            <span className="empty-icon">
              <Link2 size={19} />
            </span>
            <h3>No links created yet</h3>
          </div>
        )}
      </Card>
    </>
  );
}
