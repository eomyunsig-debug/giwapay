'use client';

import { Check, ExternalLink, Info, ShieldCheck } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { isAddress, zeroAddress, type Address } from 'viem';
import { useAccount, usePublicClient, useSwitchChain, useWriteContract } from 'wagmi';

import { GIWA_SEPOLIA_CHAIN_ID } from '@giwapay/chains';
import { GiwaPayApiError, merchantRegistryAbi } from '@giwapay/sdk';
import { Button, Card, Field, Input } from '@giwapay/ui';
import { giwaPayClient } from '@/lib/api';
import { MERCHANT_REGISTRY_ADDRESS, transactionExplorerUrl } from '@/lib/config';
import { shortAddress } from '@/lib/format';
import { ErrorState, LoadingState } from './async-state';
import { Bilingual } from './bilingual';
import { ProgressiveDisclosure } from './progressive-disclosure';

export function OnboardingPanel() {
  const { address, isConnected, chainId } = useAccount();
  const publicClient = usePublicClient({ chainId: GIWA_SEPOLIA_CHAIN_ID });
  const { switchChainAsync } = useSwitchChain();
  const { writeContractAsync } = useWriteContract();
  const merchant = useQuery({
    queryKey: ['dashboard', 'merchant'],
    queryFn: () => giwaPayClient.getMerchantContext(),
  });
  const [name, setName] = useState<string>();
  const [payout, setPayout] = useState<string>();
  const [submitting, setSubmitting] = useState(false);
  const [submittedHash, setSubmittedHash] = useState<`0x${string}`>();
  const [newAdmin, setNewAdmin] = useState('');
  const [adminTransferHash, setAdminTransferHash] = useState<`0x${string}`>();
  const [error, setError] = useState<string>();
  const merchantIdentity = merchant.data?.merchant.onchainMerchantAddress;
  const onchainRegistration = useQuery({
    queryKey: ['merchant-registration', MERCHANT_REGISTRY_ADDRESS, merchantIdentity],
    enabled: Boolean(MERCHANT_REGISTRY_ADDRESS && merchantIdentity && publicClient),
    queryFn: async () => {
      const registryAddress = MERCHANT_REGISTRY_ADDRESS;
      if (!registryAddress || !merchantIdentity || !publicClient) return undefined;
      return publicClient.readContract({
        address: registryAddress,
        abi: merchantRegistryAbi,
        functionName: 'getMerchant',
        args: [merchantIdentity],
      });
    },
    refetchInterval: submittedHash ? 2_000 : false,
  });
  const pendingAdmin = useQuery({
    queryKey: ['merchant-pending-admin', MERCHANT_REGISTRY_ADDRESS, merchantIdentity],
    enabled: Boolean(
      MERCHANT_REGISTRY_ADDRESS &&
      merchantIdentity &&
      publicClient &&
      merchant.data?.merchant.onchainRegisteredAt,
    ),
    queryFn: async () => {
      if (!MERCHANT_REGISTRY_ADDRESS || !merchantIdentity || !publicClient) return zeroAddress;
      return publicClient.readContract({
        address: MERCHANT_REGISTRY_ADDRESS,
        abi: merchantRegistryAbi,
        functionName: 'pendingAdmin',
        args: [merchantIdentity],
      });
    },
  });

  if (merchant.isLoading) return <LoadingState label="Loading merchant state…" />;
  if (merchant.error || !merchant.data) {
    return (
      <ErrorState
        title="Could not load onboarding state"
        error={merchant.error ?? new Error('Merchant context is unavailable')}
      />
    );
  }

  const displayName = name ?? merchant.data.merchant.displayName;
  const payoutAddress = payout ?? merchant.data.merchant.payoutAddress ?? address ?? '';
  const signer =
    merchant.data.requiredDelegatedSignerAddress ??
    merchant.data.merchant.delegatedSignerAddress ??
    '';
  const profileComplete = Boolean(
    merchant.data?.merchant.displayName &&
    merchant.data.merchant.payoutAddress &&
    merchant.data.requiredDelegatedSignerAddress,
  );
  const registered = Boolean(merchant.data?.merchant.onchainRegisteredAt);
  const registrationExistsOnchain = Boolean(
    onchainRegistration.data &&
    onchainRegistration.data.admin !== zeroAddress &&
    onchainRegistration.data.createdAt > 0n,
  );
  const submittedExplorerUrl = submittedHash ? transactionExplorerUrl(submittedHash) : undefined;
  const pendingAdminAddress =
    pendingAdmin.data && pendingAdmin.data !== zeroAddress ? pendingAdmin.data : undefined;
  const adminTransferUrl =
    pendingAdminAddress && merchantIdentity
      ? `${typeof window === 'undefined' ? '' : window.location.origin}/admin-transfer/${merchantIdentity}`
      : undefined;

  const verifyRegistration = async (): Promise<boolean> => {
    setSubmitting(true);
    setError(undefined);
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        await giwaPayClient.verifyMerchantRegistration();
        await merchant.refetch();
        setSubmitting(false);
        return true;
      } catch (caught) {
        const retryable = caught instanceof GiwaPayApiError && [409, 503].includes(caught.status);
        if (!retryable) {
          setSubmitting(false);
          setError(caught instanceof Error ? caught.message : 'Registration verification failed');
          return false;
        }
        if (attempt < 4) {
          await new Promise((resolve) =>
            window.setTimeout(resolve, Math.min(1_000 * 2 ** attempt, 4_000)),
          );
        }
      }
    }
    setSubmitting(false);
    setError(
      'The transaction is mined but has not reached the backend confirmation threshold. Use Verify registration shortly; do not send another registration.',
    );
    return false;
  };

  const register = async (event: FormEvent) => {
    event.preventDefault();
    setError(undefined);
    if (!address || !isConnected) {
      setError('Connect the merchant admin wallet first.');
      return;
    }
    if (!isAddress(payoutAddress) || !isAddress(signer)) {
      setError('Enter valid payout and delegated signer addresses.');
      return;
    }
    if (!MERCHANT_REGISTRY_ADDRESS || !publicClient) {
      setError(
        'MerchantRegistry is not configured for this deployment. Set NEXT_PUBLIC_MERCHANT_REGISTRY_ADDRESS.',
      );
      return;
    }

    setSubmitting(true);
    try {
      await giwaPayClient.updateMerchant({ displayName });
      if (chainId !== GIWA_SEPOLIA_CHAIN_ID) {
        await switchChainAsync({ chainId: GIWA_SEPOLIA_CHAIN_ID });
      }
      const hash = await writeContractAsync({
        address: MERCHANT_REGISTRY_ADDRESS,
        abi: merchantRegistryAbi,
        functionName: 'registerMerchant',
        args: [payoutAddress as Address, signer as Address],
        chainId: GIWA_SEPOLIA_CHAIN_ID,
      });
      setSubmittedHash(hash);
      const receipt = await publicClient.waitForTransactionReceipt({
        hash,
        confirmations: 1,
      });
      if (receipt.status !== 'success') {
        throw new Error('Merchant registration transaction reverted.');
      }
      await onchainRegistration.refetch();
      await verifyRegistration();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Registration failed');
    } finally {
      setSubmitting(false);
    }
  };

  const proposeAdminTransfer = async (event: FormEvent) => {
    event.preventDefault();
    setError(undefined);
    if (
      !address ||
      !isAddress(newAdmin) ||
      !MERCHANT_REGISTRY_ADDRESS ||
      !publicClient ||
      !merchantIdentity
    ) {
      setError('Connect the current admin wallet and enter a valid replacement admin address.');
      return;
    }
    setSubmitting(true);
    try {
      if (chainId !== GIWA_SEPOLIA_CHAIN_ID) {
        await switchChainAsync({ chainId: GIWA_SEPOLIA_CHAIN_ID });
      }
      const hash = await writeContractAsync({
        address: MERCHANT_REGISTRY_ADDRESS,
        abi: merchantRegistryAbi,
        functionName: 'proposeAdmin',
        args: [newAdmin as Address],
        chainId: GIWA_SEPOLIA_CHAIN_ID,
      });
      setAdminTransferHash(hash);
      const receipt = await publicClient.waitForTransactionReceipt({ hash, confirmations: 1 });
      if (receipt.status !== 'success') throw new Error('Admin transfer proposal reverted.');
      await pendingAdmin.refetch();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Admin transfer proposal failed');
    } finally {
      setSubmitting(false);
    }
  };

  const cancelAdminTransfer = async () => {
    setError(undefined);
    if (!MERCHANT_REGISTRY_ADDRESS || !publicClient) return;
    setSubmitting(true);
    try {
      if (chainId !== GIWA_SEPOLIA_CHAIN_ID) {
        await switchChainAsync({ chainId: GIWA_SEPOLIA_CHAIN_ID });
      }
      const hash = await writeContractAsync({
        address: MERCHANT_REGISTRY_ADDRESS,
        abi: merchantRegistryAbi,
        functionName: 'cancelAdminTransfer',
        args: [],
        chainId: GIWA_SEPOLIA_CHAIN_ID,
      });
      const receipt = await publicClient.waitForTransactionReceipt({ hash, confirmations: 1 });
      if (receipt.status !== 'success') throw new Error('Admin transfer cancellation reverted.');
      setAdminTransferHash(hash);
      setNewAdmin('');
      await pendingAdmin.refetch();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Admin transfer cancellation failed');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <div className="page-heading">
        <div>
          <h1>
            <Bilingual ko="판매자 온보딩" en="Merchant onboarding" />
          </h1>
          <p>
            Keep merchant administration, payout, and invoice-signing authority deliberately
            separated.
          </p>
        </div>
      </div>

      <div className="form-grid" style={{ alignItems: 'start' }}>
        <Card className="panel">
          <div className="panel-header">
            <h2>
              <Bilingual ko="온체인 판매자 등록" en="Onchain merchant registration" />
            </h2>
          </div>
          <form className="panel-body" onSubmit={register}>
            <div className="form-grid">
              <Field label="Merchant display name" htmlFor="merchant-name" className="full">
                <Input
                  id="merchant-name"
                  value={displayName}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="Namu Studio"
                  maxLength={120}
                  required
                />
              </Field>
              <Field
                label="Payout address"
                htmlFor="payout-address"
                hint="Only the merchant admin can update this address onchain."
                className="full"
              >
                <Input
                  id="payout-address"
                  className="mono"
                  value={payoutAddress}
                  onChange={(event) => setPayout(event.target.value)}
                  placeholder="0x…"
                  spellCheck={false}
                  required
                />
              </Field>
              <Field
                label="Delegated PaymentIntent signer"
                htmlFor="delegated-signer"
                hint="This address may sign invoices only. It cannot change payout or split recipients."
                className="full"
              >
                <Input
                  id="delegated-signer"
                  className="mono"
                  value={signer}
                  placeholder="0x…"
                  spellCheck={false}
                  readOnly
                  required
                />
              </Field>
            </div>
            {error ? (
              <p className="gp-field-error" role="alert">
                {error}
              </p>
            ) : null}
            {submittedHash && !registered ? (
              <div className="info-banner" role="status">
                <Info size={16} />
                <span>
                  Transaction mined. Waiting for a confirmed MerchantRegistry read; this is not
                  active yet.{' '}
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
            <div className="form-actions">
              <Button
                type="submit"
                size="lg"
                loading={submitting}
                disabled={
                  registered ||
                  !MERCHANT_REGISTRY_ADDRESS ||
                  Boolean(submittedHash) ||
                  registrationExistsOnchain
                }
              >
                {registered ? (
                  <>
                    <Check size={16} /> Registration verified
                  </>
                ) : (
                  'Register on GIWA Sepolia'
                )}
              </Button>
              {!registered && (Boolean(submittedHash) || registrationExistsOnchain) ? (
                <Button
                  variant="secondary"
                  size="lg"
                  loading={submitting}
                  onClick={verifyRegistration}
                >
                  Verify registration
                </Button>
              ) : null}
            </div>
          </form>
        </Card>

        <div className="step-list">
          <div className="step-row" data-complete={isConnected}>
            <span className="step-number">{isConnected ? <Check size={14} /> : '1'}</span>
            <span>
              <strong>Admin wallet</strong>
              <small>{address ? shortAddress(address) : 'Connect your merchant wallet'}</small>
            </span>
          </div>
          <div className="step-row" data-complete={profileComplete}>
            <span className="step-number">{profileComplete ? <Check size={14} /> : '2'}</span>
            <span>
              <strong>Merchant profile</strong>
              <small>Payout and signer addresses configured</small>
            </span>
          </div>
          <div className="step-row" data-complete={registered}>
            <span className="step-number">{registered ? <Check size={14} /> : '3'}</span>
            <span>
              <strong>Onchain registration</strong>
              <small>
                {registered ? 'Verified by chain indexer' : 'Requires one GIWA transaction'}
              </small>
            </span>
          </div>
          <ProgressiveDisclosure
            summary={<Bilingual ko="권한 구조 보기" en="View permission boundaries" />}
            description={
              <Bilingual
                ko="관리자, 지급 주소와 청구서 서명자의 역할"
                en="Admin, payout, and invoice signer roles"
              />
            }
          >
            <div className="info-banner">
              <ShieldCheck size={17} />
              <span>
                <Bilingual
                  ko="위임 서명자는 청구서만 서명합니다. 지급 주소, 정산 분배, 플랫폼 수수료, 어댑터와 판매자 자금을 변경할 수 없습니다."
                  en="The delegated signer can sign invoices only. It cannot edit payout addresses, split templates, platform fees, adapters, or merchant funds."
                />
              </span>
            </div>
          </ProgressiveDisclosure>
        </div>
      </div>

      {registered ? (
        <ProgressiveDisclosure
          className="account-management-disclosure"
          summary={<Bilingual ko="고급 계정 관리" en="Advanced account management" />}
          description={
            <Bilingual ko="판매자 관리자 2단계 이전" en="Two-step merchant admin transfer" />
          }
        >
          <Card className="panel">
            <div className="panel-header">
              <h2>
                <Bilingual ko="판매자 관리자 이전" en="Rotate merchant admin" />
              </h2>
            </div>
            <form className="panel-body" onSubmit={proposeAdminTransfer}>
              <p className="metric-caption">
                The merchant identity remains <span className="mono">{merchantIdentity}</span>.
                Existing PaymentIntents, splits, and refund records do not move.
              </p>
              <Field
                label="Replacement admin"
                htmlFor="replacement-admin"
                hint="The replacement wallet must explicitly accept onchain. This does not recover an already lost key."
              >
                <Input
                  id="replacement-admin"
                  className="mono"
                  value={pendingAdminAddress ?? newAdmin}
                  onChange={(event) => setNewAdmin(event.target.value)}
                  readOnly={Boolean(pendingAdminAddress)}
                  placeholder="0x…"
                  spellCheck={false}
                  required
                />
              </Field>
              {pendingAdminAddress ? (
                <div className="info-banner" role="status">
                  <Info size={16} />
                  <span>
                    Pending acceptance by <span className="mono">{pendingAdminAddress}</span>.
                    {adminTransferUrl ? (
                      <>
                        {' '}
                        Share only this acceptance link:{' '}
                        <a className="explorer-link" href={adminTransferUrl}>
                          Open transfer <ExternalLink size={11} />
                        </a>
                      </>
                    ) : null}
                  </span>
                </div>
              ) : null}
              {adminTransferHash ? (
                <p className="metric-caption">
                  Last admin-transfer transaction: {shortAddress(adminTransferHash)}
                </p>
              ) : null}
              <div className="form-actions">
                {pendingAdminAddress ? (
                  <Button
                    type="button"
                    variant="secondary"
                    loading={submitting}
                    onClick={() => void cancelAdminTransfer()}
                  >
                    Cancel pending transfer
                  </Button>
                ) : (
                  <Button type="submit" loading={submitting} disabled={!isAddress(newAdmin)}>
                    Propose two-step transfer
                  </Button>
                )}
              </div>
            </form>
          </Card>
        </ProgressiveDisclosure>
      ) : null}
    </>
  );
}
