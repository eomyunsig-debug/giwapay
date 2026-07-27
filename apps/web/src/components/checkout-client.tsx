'use client';

import {
  ArrowRight,
  Check,
  Clock3,
  ExternalLink,
  Info,
  LockKeyhole,
  ShieldCheck,
  Wallet,
} from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { zeroAddress, type Address, type Hex } from 'viem';
import { useAccount, usePublicClient, useSwitchChain, useWalletClient } from 'wagmi';

import { GIWA_SEPOLIA_CHAIN_ID } from '@giwapay/chains';
import { erc20ApprovalAbi, type PaymentQuote } from '@giwapay/sdk';
import { Button, Card, DefinitionRow, Divider } from '@giwapay/ui';
import { giwaPayClient } from '@/lib/api';
import { getConfiguredToken, transactionExplorerUrl } from '@/lib/config';
import { formatBasisPoints, formatDateTime, formatRawAmount, shortAddress } from '@/lib/format';
import { ensureGiwaWalletClient, sendWalletTransaction } from '@/lib/wallet';
import { Brand } from './brand';
import { ErrorState, LoadingState } from './async-state';
import { LanguageToggle } from './language-toggle';
import { StatusBadge } from './status-badge';
import { TestnetFaucetButton } from './testnet-faucet-button';
import { WalletButton } from './wallet-button';

type PaymentPhase = 'idle' | 'preparing' | 'approving' | 'paying' | 'verifying';

const quoteIsFresh = (quote?: PaymentQuote): boolean =>
  Boolean(quote && new Date(quote.expiresAt).getTime() > Date.now() + 2_000);

const quoteTermsMatch = (displayed: PaymentQuote, prepared: PaymentQuote) =>
  displayed.tokenIn.toLowerCase() === prepared.tokenIn.toLowerCase() &&
  displayed.settlementToken.toLowerCase() === prepared.settlementToken.toLowerCase() &&
  displayed.exactMerchantAmount === prepared.exactMerchantAmount &&
  displayed.platformFee === prepared.platformFee &&
  displayed.estimatedInputAmount === prepared.estimatedInputAmount &&
  displayed.maximumInputAmount === prepared.maximumInputAmount &&
  displayed.slippageBps === prepared.slippageBps &&
  displayed.adapter.toLowerCase() === prepared.adapter.toLowerCase() &&
  displayed.adapterIdentifier === prepared.adapterIdentifier &&
  displayed.router.toLowerCase() === prepared.router.toLowerCase() &&
  displayed.approvalSpender.toLowerCase() === prepared.approvalSpender.toLowerCase() &&
  JSON.stringify(
    displayed.settlementRecipients.map(({ address, basisPoints }) => [
      address.toLowerCase(),
      basisPoints,
    ]),
  ) ===
    JSON.stringify(
      prepared.settlementRecipients.map(({ address, basisPoints }) => [
        address.toLowerCase(),
        basisPoints,
      ]),
    );

export function CheckoutClient({ id }: { id: string }) {
  const queryClient = useQueryClient();
  const { address, isConnected, chainId } = useAccount();
  const walletClientQuery = useWalletClient({
    chainId: GIWA_SEPOLIA_CHAIN_ID,
  });
  const walletClient = walletClientQuery.data;
  const publicClient = usePublicClient({ chainId: GIWA_SEPOLIA_CHAIN_ID });
  const { switchChainAsync } = useSwitchChain();
  const [selectedTokenOverride, setSelectedToken] = useState<Address>();
  const [slippageBps] = useState(100);
  const [phase, setPhase] = useState<PaymentPhase>('idle');
  const [submittedHash, setSubmittedHash] = useState<Hex>();
  const [error, setError] = useState<string>();

  const detail = useQuery({
    queryKey: ['checkout', 'payment-intent', id],
    queryFn: () => giwaPayClient.getPaymentIntent(id),
    refetchInterval: (query) =>
      ['created', 'submitted'].includes(query.state.data?.paymentIntent.status ?? '')
        ? 2_000
        : false,
  });

  const intent = detail.data?.paymentIntent;
  const methods = useQuery({
    queryKey: ['checkout', 'payment-methods', intent?.settlement.token],
    queryFn: () => giwaPayClient.listPaymentMethods(intent!.settlement.token),
    enabled: Boolean(intent),
  });
  const selectableTokens = (methods.data?.data ?? []).map((method) => method.token);
  const selectedToken = selectedTokenOverride ?? selectableTokens[0]?.address;
  const settlementToken =
    methods.data?.data[0]?.settlementToken ??
    (intent ? getConfiguredToken(intent.settlement.token) : undefined);

  const quote = useQuery({
    queryKey: ['checkout', 'quote', id, selectedToken, slippageBps],
    queryFn: () => giwaPayClient.quotePayment(id, selectedToken!, slippageBps),
    enabled: Boolean(selectedToken && intent?.status === 'created' && !submittedHash),
    refetchInterval: 20_000,
    retry: false,
  });

  if (detail.isLoading) {
    return (
      <CheckoutFrame>
        <Card className="checkout-main">
          <LoadingState label="Loading signed PaymentIntent…" />
        </Card>
      </CheckoutFrame>
    );
  }
  if (detail.error || !intent) {
    return (
      <CheckoutFrame>
        <Card className="checkout-main">
          <ErrorState
            title="Checkout unavailable"
            error={detail.error ?? new Error('PaymentIntent not found')}
          />
        </Card>
      </CheckoutFrame>
    );
  }

  const selectedMetadata = selectableTokens.find((token) => token.address === selectedToken);
  const expired = intent.status === 'expired';
  const verifiedPaid = ['succeeded', 'partially_refunded', 'refunded'].includes(intent.status);
  const quoteValue = quote.data;
  const submittedExplorerUrl = submittedHash ? transactionExplorerUrl(submittedHash) : undefined;
  const canExecute =
    isConnected &&
    address &&
    publicClient &&
    quoteValue &&
    !expired &&
    !verifiedPaid &&
    intent.settlementRecipients.length > 0 &&
    phase === 'idle';

  const execute = async () => {
    if (!address || !selectedToken || !publicClient || !quoteValue) {
      return;
    }
    setError(undefined);
    try {
      const activeWalletClient = await ensureGiwaWalletClient({
        chainId,
        walletClient,
        switchChain: () => switchChainAsync({ chainId: GIWA_SEPOLIA_CHAIN_ID }),
        refreshWalletClient: async () => (await walletClientQuery.refetch()).data,
      });
      setPhase('preparing');
      const prepared = await giwaPayClient.preparePayment(id, {
        tokenIn: selectedToken,
        quoteId: quoteValue.quoteId,
        slippageBps,
      });
      if (!quoteTermsMatch(quoteValue, prepared.quote)) {
        queryClient.setQueryData(
          ['checkout', 'quote', id, selectedToken, slippageBps],
          prepared.quote,
        );
        setError(
          'Payment terms changed. Review the refreshed estimate, maximum input, fee, route, and recipients, then click again.',
        );
        setPhase('idle');
        return;
      }
      if (!quoteIsFresh(prepared.quote)) {
        await quote.refetch();
        setError('The quote expired. Review the refreshed terms and click again.');
        setPhase('idle');
        return;
      }

      const allowance = await publicClient.readContract({
        address: prepared.approval.token,
        abi: erc20ApprovalAbi,
        functionName: 'allowance',
        args: [address, prepared.approval.spender],
      });
      if (prepared.approval.required && allowance < BigInt(prepared.approval.amount)) {
        setPhase('approving');
        const approvalHash = await sendWalletTransaction(activeWalletClient, {
          account: address,
          to: prepared.approval.transaction.to,
          data: prepared.approval.transaction.data,
          value: BigInt(prepared.approval.transaction.value),
        });
        const approvalReceipt = await publicClient.waitForTransactionReceipt({
          hash: approvalHash,
          confirmations: 1,
        });
        if (approvalReceipt.status !== 'success') {
          throw new Error('Token approval reverted.');
        }
      }

      setPhase('paying');
      const transaction = prepared.payment.transaction;
      const paymentHash = await sendWalletTransaction(activeWalletClient, {
        account: address,
        to: transaction.to,
        data: transaction.data,
        value: BigInt(transaction.value),
      });
      setSubmittedHash(paymentHash);
      const receipt = await publicClient.waitForTransactionReceipt({
        hash: paymentHash,
        confirmations: 1,
      });
      if (receipt.status !== 'success') {
        throw new Error('Payment transaction reverted.');
      }
      setPhase('verifying');
      await detail.refetch();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Payment failed');
      setPhase('idle');
    }
  };

  const actionLabel: Record<PaymentPhase, string> = {
    idle: 'Approve & pay',
    preparing: 'Refreshing live quote…',
    approving: 'Approve token in wallet…',
    paying: 'Submit payment in wallet…',
    verifying: 'Verifying chain event…',
  };

  return (
    <CheckoutFrame>
      <div className="checkout-grid">
        <Card className="checkout-main">
          {settlementToken?.testOnly || selectableTokens.some((token) => token.testOnly) ? (
            <div className="test-token-banner">
              <Info size={14} />
              Testnet demo · Mock tokens have no monetary value.
            </div>
          ) : null}
          <div className="merchant-lockup">
            <span className="merchant-avatar">
              {(intent.merchant?.name ?? 'M').slice(0, 1).toUpperCase()}
            </span>
            <span>
              <strong>{intent.merchant?.name ?? 'Verified merchant'}</strong>
              <small>
                <LockKeyhole size={10} style={{ verticalAlign: '-1px' }} /> Merchant-signed
                PaymentIntent
              </small>
            </span>
          </div>

          <p className="checkout-title">Merchant receives exactly</p>
          <p className="checkout-amount">
            {formatRawAmount(intent.settlement.amount, settlementToken?.decimals ?? 18)}{' '}
            <small>{settlementToken?.symbol ?? shortAddress(intent.settlement.token)}</small>
          </p>
          <p className="checkout-description">{intent.description}</p>

          <Divider />
          <p className="gp-label" style={{ marginTop: 19 }}>
            Choose payment asset
          </p>
          {methods.isLoading ? (
            <LoadingState label="Loading supported payment assets…" />
          ) : methods.error ? (
            <ErrorState title="Payment method registry unavailable" error={methods.error} />
          ) : selectableTokens.length === 0 ? (
            <div className="error-state" role="alert">
              <div>
                <strong>No verified payment tokens configured</strong>
                <p>This checkout cannot safely infer token addresses or decimals.</p>
              </div>
            </div>
          ) : (
            <div className="asset-list" role="radiogroup" aria-label="Payment asset">
              {selectableTokens.map((token) => {
                const selected = token.address === selectedToken;
                return (
                  <button
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    className="asset-option"
                    data-selected={selected}
                    onClick={() => {
                      setSelectedToken(token.address);
                      setSubmittedHash(undefined);
                      setPhase('idle');
                    }}
                    key={token.address}
                    disabled={phase !== 'idle'}
                  >
                    <span className="token-identity">
                      <span className="token-symbol">{token.symbol.slice(0, 1)}</span>
                      <span>
                        <strong>
                          {token.testOnly ? 'Testnet demo · ' : ''}
                          {token.name}
                        </strong>
                        <small>{shortAddress(token.address)}</small>
                      </span>
                    </span>
                    <span className="asset-amount">
                      {selected && quote.isFetching ? (
                        <small>Live quote…</small>
                      ) : selected && quoteValue ? (
                        <>
                          <strong>
                            ≈ {formatRawAmount(quoteValue.estimatedInputAmount, token.decimals)}{' '}
                            {token.symbol}
                          </strong>
                          <small>
                            max {formatRawAmount(quoteValue.maximumInputAmount, token.decimals)}
                          </small>
                        </>
                      ) : (
                        <small>Select for live quote</small>
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
          {quote.error ? (
            <p className="gp-field-error" role="alert">
              {quote.error.message}
            </p>
          ) : null}
          {selectedMetadata?.testOnly ? (
            <div style={{ marginTop: 12 }}>
              <TestnetFaucetButton
                token={selectedMetadata.address}
                label={selectedMetadata.symbol}
              />
            </div>
          ) : null}
        </Card>

        <Card className="checkout-summary">
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <h2>Payment details</h2>
            <StatusBadge status={intent.status} />
          </div>
          <div className="summary-total">
            <span>Estimated input</span>
            <strong>
              {quoteValue && selectedMetadata
                ? `${formatRawAmount(
                    quoteValue.estimatedInputAmount,
                    selectedMetadata.decimals,
                  )} ${selectedMetadata.symbol}`
                : '—'}
            </strong>
          </div>
          <dl>
            <DefinitionRow term="Selected input token">
              {selectedMetadata && selectedToken ? (
                <span>
                  {selectedMetadata.symbol}
                  <br />
                  <span className="mono">{selectedToken}</span>
                </span>
              ) : (
                '—'
              )}
            </DefinitionRow>
            <DefinitionRow term="Settlement token">
              <span>
                {settlementToken?.symbol ?? 'Token'}
                <br />
                <span className="mono">{intent.settlement.token}</span>
              </span>
            </DefinitionRow>
            <DefinitionRow term="Maximum input">
              {quoteValue && selectedMetadata
                ? `${formatRawAmount(
                    quoteValue.maximumInputAmount,
                    selectedMetadata.decimals,
                  )} ${selectedMetadata.symbol}`
                : '—'}
            </DefinitionRow>
            <DefinitionRow term="Slippage">
              {quoteValue ? formatBasisPoints(quoteValue.slippageBps) : '—'}
            </DefinitionRow>
            <DefinitionRow term="Platform fee">
              {formatRawAmount(intent.platformFee, settlementToken?.decimals ?? 18)}{' '}
              {settlementToken?.symbol ?? shortAddress(intent.settlement.token)}
            </DefinitionRow>
            <DefinitionRow term="Adapter">
              {quoteValue ? (
                <>
                  {quoteValue.adapterIdentifier}
                  <br />
                  <span className="mono">
                    {quoteValue.adapter === zeroAddress ? 'Direct token' : quoteValue.adapter}
                  </span>
                </>
              ) : (
                '—'
              )}
            </DefinitionRow>
            <DefinitionRow term="Settlement recipient">
              {(quoteValue?.settlementRecipients ?? intent.settlementRecipients).map((split) => (
                <span key={split.address} style={{ display: 'block' }}>
                  <span className="mono">{split.address}</span>
                  <br />
                  {formatBasisPoints(split.basisPoints)}
                </span>
              ))}
            </DefinitionRow>
            <DefinitionRow term="Payment router">
              <span className="mono">{quoteValue?.router ?? intent.routerAddress}</span>
            </DefinitionRow>
            <DefinitionRow term="Approval spender">
              <span className="mono">{quoteValue?.approvalSpender ?? '—'}</span>
            </DefinitionRow>
            <DefinitionRow term="Expires">{formatDateTime(intent.expiresAt)}</DefinitionRow>
          </dl>

          {submittedHash && !verifiedPaid ? (
            <div className="info-banner" role="status">
              <ShieldCheck size={16} />
              <span>
                Transaction submitted, but payment is not yet marked successful. Waiting for the
                independent indexer.{' '}
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

          {verifiedPaid ? (
            <Link
              className="gp-button gp-button--primary gp-button--lg checkout-submit"
              href={`/receipt/${encodeURIComponent(intent.id)}`}
            >
              <Check size={16} /> View verified receipt
            </Link>
          ) : !isConnected ? (
            <div style={{ marginTop: 18 }}>
              <WalletButton />
            </div>
          ) : (
            <Button
              className="checkout-submit"
              size="lg"
              onClick={execute}
              disabled={!canExecute}
              loading={phase !== 'idle'}
            >
              {phase === 'idle' && chainId !== GIWA_SEPOLIA_CHAIN_ID
                ? 'Switch to GIWA & pay'
                : actionLabel[phase]}
              {phase === 'idle' ? <ArrowRight size={16} /> : null}
            </Button>
          )}
          <p className="checkout-disclaimer">
            <Wallet size={10} /> GiwaPay never takes custody between transactions. A wallet
            submission is not a successful payment until the chain event is independently verified.
          </p>
        </Card>
      </div>
    </CheckoutFrame>
  );
}

function CheckoutFrame({ children }: { children: React.ReactNode }) {
  return (
    <main className="checkout-page" id="main-content">
      <header className="checkout-header">
        <Brand />
        <div className="header-actions">
          <span className="secure-label">
            <Clock3 size={12} /> GIWA Sepolia
          </span>
          <LanguageToggle />
        </div>
      </header>
      {children}
    </main>
  );
}
