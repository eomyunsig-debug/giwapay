'use client';

import { Check, Info, ShieldCheck } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { zeroAddress, type Address, type Hex } from 'viem';
import { useAccount, usePublicClient, useSwitchChain, useWriteContract } from 'wagmi';

import { GIWA_SEPOLIA_CHAIN_ID } from '@giwapay/chains';
import { merchantRegistryAbi } from '@giwapay/sdk';
import { Button, Card, DefinitionRow } from '@giwapay/ui';
import { MERCHANT_REGISTRY_ADDRESS, transactionExplorerUrl } from '@/lib/config';
import { shortAddress } from '@/lib/format';
import { Brand } from './brand';
import { LanguageToggle, useGiwaPayLocale } from './language-toggle';
import { WalletButton } from './wallet-button';

export function AdminTransferClient({ merchant }: { merchant: Address }) {
  const locale = useGiwaPayLocale();
  const ko = locale === 'ko';
  const { address, chainId } = useAccount();
  const publicClient = usePublicClient({ chainId: GIWA_SEPOLIA_CHAIN_ID });
  const { switchChainAsync } = useSwitchChain();
  const { writeContractAsync } = useWriteContract();
  const [submitting, setSubmitting] = useState(false);
  const [acceptedHash, setAcceptedHash] = useState<Hex>();
  const [error, setError] = useState<string>();
  const transfer = useQuery({
    queryKey: ['public-admin-transfer', MERCHANT_REGISTRY_ADDRESS, merchant],
    enabled: Boolean(MERCHANT_REGISTRY_ADDRESS && publicClient),
    queryFn: async () => {
      if (!MERCHANT_REGISTRY_ADDRESS || !publicClient) return undefined;
      const [record, pendingAdmin] = await Promise.all([
        publicClient.readContract({
          address: MERCHANT_REGISTRY_ADDRESS,
          abi: merchantRegistryAbi,
          functionName: 'getMerchant',
          args: [merchant],
        }),
        publicClient.readContract({
          address: MERCHANT_REGISTRY_ADDRESS,
          abi: merchantRegistryAbi,
          functionName: 'pendingAdmin',
          args: [merchant],
        }),
      ]);
      return { record, pendingAdmin };
    },
  });
  const pendingAdmin = transfer.data?.pendingAdmin;
  const eligible =
    Boolean(address && pendingAdmin && pendingAdmin !== zeroAddress) &&
    address?.toLowerCase() === pendingAdmin?.toLowerCase();

  const accept = async () => {
    if (!eligible || !MERCHANT_REGISTRY_ADDRESS || !publicClient) return;
    setSubmitting(true);
    setError(undefined);
    try {
      if (chainId !== GIWA_SEPOLIA_CHAIN_ID) {
        await switchChainAsync({ chainId: GIWA_SEPOLIA_CHAIN_ID });
      }
      const hash = await writeContractAsync({
        address: MERCHANT_REGISTRY_ADDRESS,
        abi: merchantRegistryAbi,
        functionName: 'acceptAdmin',
        args: [merchant],
        chainId: GIWA_SEPOLIA_CHAIN_ID,
      });
      const receipt = await publicClient.waitForTransactionReceipt({ hash, confirmations: 1 });
      if (receipt.status !== 'success') {
        throw new Error(
          ko ? '관리자 수락 거래가 취소되었습니다.' : 'Admin acceptance transaction reverted.',
        );
      }
      setAcceptedHash(hash);
      await transfer.refetch();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : ko
            ? '관리자 수락에 실패했습니다.'
            : 'Admin acceptance failed',
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="checkout-page" id="main-content">
      <header className="checkout-header">
        <Brand />
        <LanguageToggle />
      </header>
      <Card className="login-card" style={{ margin: '72px auto' }}>
        <p className="eyebrow">{ko ? '2단계 관리자 이전' : 'Two-step admin rotation'}</p>
        <h2>{ko ? '판매자 관리자 권한 수락' : 'Accept merchant administration'}</h2>
        <p>
          {ko
            ? 'GIWA Sepolia 거래를 제출하기 전에 고정 판매자 식별자와 현재 관리자를 확인하세요.'
            : 'Confirm the stable merchant identity and current admin before submitting one GIWA Sepolia transaction.'}
        </p>
        <dl>
          <DefinitionRow term={ko ? '고정 판매자' : 'Stable merchant'}>
            <span className="mono">{merchant}</span>
          </DefinitionRow>
          <DefinitionRow term={ko ? '현재 관리자' : 'Current admin'}>
            <span className="mono">{transfer.data?.record.admin ?? '—'}</span>
          </DefinitionRow>
          <DefinitionRow term={ko ? '수락 대기 관리자' : 'Pending admin'}>
            <span className="mono">{pendingAdmin ?? '—'}</span>
          </DefinitionRow>
        </dl>
        <div className="info-banner">
          <ShieldCheck size={16} />
          <span>
            {ko
              ? '수락은 관리자 권한만 변경합니다. 지급 주소, 위임 서명자, 분배 템플릿, 과거 결제와 환불은 동일한 판매자 네임스페이스를 유지합니다.'
              : 'Acceptance changes administration only. Payout, delegated signer, split templates, historical payments, and refunds keep the same merchant namespace.'}
          </span>
        </div>
        {!address ? (
          <WalletButton />
        ) : acceptedHash ? (
          <>
            <div className="info-banner success-banner">
              <Check size={16} />
              <span>
                {ko
                  ? '관리자 이전이 수락되었습니다. 거래 '
                  : 'Admin transfer accepted. Transaction '}
                {transactionExplorerUrl(acceptedHash) ? (
                  <a
                    className="explorer-link"
                    href={transactionExplorerUrl(acceptedHash)}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {shortAddress(acceptedHash)}
                  </a>
                ) : (
                  shortAddress(acceptedHash)
                )}
              </span>
            </div>
            <Link className="gp-button gp-button--primary" href="/login">
              {ko ? '새 관리자로 로그인' : 'Sign in as the new admin'}
            </Link>
          </>
        ) : (
          <Button
            size="lg"
            onClick={() => void accept()}
            loading={submitting}
            disabled={!eligible || transfer.isLoading}
          >
            {ko ? 'GIWA에서 관리자 권한 수락' : 'Accept admin role on GIWA'}
          </Button>
        )}
        {address && pendingAdmin && !eligible && !acceptedHash ? (
          <div className="info-banner" role="alert">
            <Info size={16} />
            <span>
              {ko
                ? `연결된 지갑 ${shortAddress(address)}은(는) 수락 대기 관리자가 아닙니다. ${shortAddress(pendingAdmin)}(으)로 전환하세요.`
                : `Connected wallet ${shortAddress(address)} is not the pending admin. Switch to ${shortAddress(pendingAdmin)}.`}
            </span>
          </div>
        ) : null}
        {error ? (
          <p className="gp-field-error" role="alert">
            {error}
          </p>
        ) : null}
      </Card>
    </main>
  );
}
