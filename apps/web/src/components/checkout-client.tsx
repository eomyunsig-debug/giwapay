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
import {
  formatBasisPoints,
  formatDateTime,
  formatMaximumRawAmount,
  formatRawAmount,
  shortAddress,
} from '@/lib/format';
import { ensureGiwaWalletClient, sendWalletTransaction } from '@/lib/wallet';
import { Brand } from './brand';
import { ErrorState, LoadingState } from './async-state';
import { LanguageToggle, useGiwaPayLocale } from './language-toggle';
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
  const locale = useGiwaPayLocale();
  const ko = locale === 'ko';
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
          <LoadingState
            label={ko ? '서명된 결제 요청을 불러오는 중…' : 'Loading signed PaymentIntent…'}
          />
        </Card>
      </CheckoutFrame>
    );
  }
  if (detail.error || !intent) {
    return (
      <CheckoutFrame>
        <Card className="checkout-main">
          <ErrorState
            title={ko ? '결제 페이지를 열 수 없습니다' : 'Checkout unavailable'}
            error={
              detail.error ??
              new Error(ko ? '결제 요청을 찾을 수 없습니다' : 'PaymentIntent not found')
            }
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
    settlementToken &&
    selectedMetadata &&
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
          ko
            ? '결제 조건이 변경되었습니다. 갱신된 예상액, 최대 입력액, 수수료, 경로와 수령인을 확인한 뒤 다시 눌러주세요.'
            : 'Payment terms changed. Review the refreshed estimate, maximum input, fee, route, and recipients, then click again.',
        );
        setPhase('idle');
        return;
      }
      if (!quoteIsFresh(prepared.quote)) {
        await quote.refetch();
        setError(
          ko
            ? '견적이 만료되었습니다. 갱신된 조건을 확인한 뒤 다시 눌러주세요.'
            : 'The quote expired. Review the refreshed terms and click again.',
        );
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
          throw new Error(ko ? '토큰 승인이 취소되었습니다.' : 'Token approval reverted.');
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
        throw new Error(ko ? '결제 거래가 취소되었습니다.' : 'Payment transaction reverted.');
      }
      setPhase('verifying');
      await detail.refetch();
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : ko ? '결제에 실패했습니다.' : 'Payment failed',
      );
      setPhase('idle');
    }
  };

  const actionLabel: Record<PaymentPhase, string> = {
    idle: ko ? '승인하고 결제' : 'Approve & pay',
    preparing: ko ? '실시간 견적 갱신 중…' : 'Refreshing live quote…',
    approving: ko ? '지갑에서 토큰 승인…' : 'Approve token in wallet…',
    paying: ko ? '지갑에서 결제 제출…' : 'Submit payment in wallet…',
    verifying: ko ? '체인 이벤트 검증 중…' : 'Verifying chain event…',
  };

  return (
    <CheckoutFrame>
      <div className="checkout-grid">
        <Card className="checkout-main">
          {settlementToken?.testOnly || selectableTokens.some((token) => token.testOnly) ? (
            <div className="test-token-banner">
              <Info size={14} />
              {ko
                ? '테스트넷 데모 · Mock 토큰은 금전적 가치가 없습니다.'
                : 'Testnet demo · Mock tokens have no monetary value.'}
            </div>
          ) : null}
          <div className="merchant-lockup">
            <span className="merchant-avatar">
              {(intent.merchant?.name ?? 'M').slice(0, 1).toUpperCase()}
            </span>
            <span>
              <strong>
                {intent.merchant?.name ?? (ko ? '검증된 판매자' : 'Verified merchant')}
              </strong>
              <small>
                <LockKeyhole size={10} style={{ verticalAlign: '-1px' }} />{' '}
                {ko ? '판매자 서명 결제 요청' : 'Merchant-signed PaymentIntent'}
              </small>
            </span>
          </div>

          <p className="checkout-title">
            {ko ? '판매자가 정확히 받는 금액' : 'Merchant receives exactly'}
          </p>
          <p className="checkout-amount">
            {settlementToken
              ? formatRawAmount(intent.settlement.amount, settlementToken.decimals)
              : ko
                ? '토큰 정보 없음'
                : 'Metadata unavailable'}{' '}
            <small>{settlementToken?.symbol ?? shortAddress(intent.settlement.token)}</small>
          </p>
          <p className="checkout-description">{intent.description}</p>

          <Divider />
          <p className="gp-label" style={{ marginTop: 19 }}>
            {ko ? '결제 자산 선택' : 'Choose payment asset'}
          </p>
          {methods.isLoading ? (
            <LoadingState
              label={ko ? '지원 결제 자산을 불러오는 중…' : 'Loading supported payment assets…'}
            />
          ) : methods.error ? (
            <ErrorState
              title={
                ko
                  ? '결제 수단 레지스트리를 사용할 수 없습니다'
                  : 'Payment method registry unavailable'
              }
              error={methods.error}
            />
          ) : selectableTokens.length === 0 ? (
            <div className="error-state" role="alert">
              <div>
                <strong>
                  {ko
                    ? '검증된 결제 토큰이 설정되지 않았습니다'
                    : 'No verified payment tokens configured'}
                </strong>
                <p>
                  {ko
                    ? '이 결제 페이지는 토큰 주소나 소수 자릿수를 임의로 추정하지 않습니다.'
                    : 'This checkout cannot safely infer token addresses or decimals.'}
                </p>
              </div>
            </div>
          ) : (
            <div
              className="asset-list"
              role="radiogroup"
              aria-label={ko ? '결제 자산' : 'Payment asset'}
            >
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
                          {token.testOnly ? (ko ? '테스트넷 데모 · ' : 'Testnet demo · ') : ''}
                          {token.name}
                        </strong>
                        <small>{shortAddress(token.address)}</small>
                      </span>
                    </span>
                    <span className="asset-amount">
                      {selected && quote.isFetching ? (
                        <small>{ko ? '실시간 견적…' : 'Live quote…'}</small>
                      ) : selected && quoteValue ? (
                        <>
                          <strong>
                            ≈ {formatRawAmount(quoteValue.estimatedInputAmount, token.decimals)}{' '}
                            {token.symbol}
                          </strong>
                          <small>
                            {ko ? '최대 ' : 'max '}
                            {formatMaximumRawAmount(quoteValue.maximumInputAmount, token.decimals)}
                          </small>
                        </>
                      ) : (
                        <small>{ko ? '선택하여 실시간 견적 확인' : 'Select for live quote'}</small>
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
            <h2>{ko ? '결제 상세' : 'Payment details'}</h2>
            <StatusBadge status={intent.status} />
          </div>
          <div className="summary-total">
            <span>{ko ? '예상 입력액' : 'Estimated input'}</span>
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
            <DefinitionRow term={ko ? '선택한 입력 토큰' : 'Selected input token'}>
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
            <DefinitionRow term={ko ? '정산 토큰' : 'Settlement token'}>
              <span>
                {settlementToken?.symbol ?? 'Token'}
                <br />
                <span className="mono">{intent.settlement.token}</span>
              </span>
            </DefinitionRow>
            <DefinitionRow term={ko ? '최대 입력액' : 'Maximum input'}>
              {quoteValue && selectedMetadata
                ? `${formatMaximumRawAmount(
                    quoteValue.maximumInputAmount,
                    selectedMetadata.decimals,
                  )} ${selectedMetadata.symbol}`
                : '—'}
            </DefinitionRow>
            <DefinitionRow term={ko ? '슬리피지' : 'Slippage'}>
              {quoteValue ? formatBasisPoints(quoteValue.slippageBps) : '—'}
            </DefinitionRow>
            <DefinitionRow term={ko ? '플랫폼 수수료' : 'Platform fee'}>
              {settlementToken
                ? formatRawAmount(intent.platformFee, settlementToken.decimals)
                : ko
                  ? '토큰 정보 없음'
                  : 'Metadata unavailable'}{' '}
              {settlementToken?.symbol ?? shortAddress(intent.settlement.token)}
            </DefinitionRow>
            <DefinitionRow term={ko ? '어댑터' : 'Adapter'}>
              {quoteValue ? (
                <>
                  {quoteValue.adapterIdentifier}
                  <br />
                  <span className="mono">
                    {quoteValue.adapter === zeroAddress
                      ? ko
                        ? '직접 토큰 결제'
                        : 'Direct token'
                      : quoteValue.adapter}
                  </span>
                </>
              ) : (
                '—'
              )}
            </DefinitionRow>
            <DefinitionRow term={ko ? '정산 수령인' : 'Settlement recipient'}>
              {(quoteValue?.settlementRecipients ?? intent.settlementRecipients).map((split) => (
                <span key={split.address} style={{ display: 'block' }}>
                  <span className="mono">{split.address}</span>
                  <br />
                  {formatBasisPoints(split.basisPoints)}
                </span>
              ))}
            </DefinitionRow>
            <DefinitionRow term={ko ? '결제 라우터' : 'Payment router'}>
              <span className="mono">{quoteValue?.router ?? intent.routerAddress}</span>
            </DefinitionRow>
            <DefinitionRow term={ko ? '승인 대상' : 'Approval spender'}>
              <span className="mono">{quoteValue?.approvalSpender ?? '—'}</span>
            </DefinitionRow>
            <DefinitionRow term={ko ? '만료 시각' : 'Expires'}>
              {formatDateTime(intent.expiresAt, ko ? 'ko-KR' : 'en-US')}
            </DefinitionRow>
          </dl>

          {submittedHash && !verifiedPaid ? (
            <div className="info-banner" role="status">
              <ShieldCheck size={16} />
              <span>
                {ko
                  ? '거래가 제출되었지만 아직 결제 성공으로 처리되지 않았습니다. 독립 인덱서 검증을 기다리는 중입니다. '
                  : 'Transaction submitted, but payment is not yet marked successful. Waiting for the independent indexer. '}
                {submittedExplorerUrl ? (
                  <a
                    className="explorer-link"
                    href={submittedExplorerUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {ko ? '탐색기' : 'Explorer'} <ExternalLink size={11} />
                  </a>
                ) : (
                  <span className="mono">
                    {ko ? '로컬 Anvil 거래' : 'Local Anvil transaction'}{' '}
                    {shortAddress(submittedHash)}
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
              <Check size={16} /> {ko ? '검증된 영수증 보기' : 'View verified receipt'}
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
                ? ko
                  ? 'GIWA로 전환하고 결제'
                  : 'Switch to GIWA & pay'
                : actionLabel[phase]}
              {phase === 'idle' ? <ArrowRight size={16} /> : null}
            </Button>
          )}
          <p className="checkout-disclaimer">
            <Wallet size={10} />{' '}
            {ko
              ? 'GiwaPay는 거래 사이에 자금을 보관하지 않습니다. 지갑에서 거래를 제출해도 체인 이벤트가 독립적으로 검증되기 전에는 결제 성공이 아닙니다.'
              : 'GiwaPay never takes custody between transactions. A wallet submission is not a successful payment until the chain event is independently verified.'}
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
