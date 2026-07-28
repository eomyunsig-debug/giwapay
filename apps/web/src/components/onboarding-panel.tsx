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
  const [error, setError] = useState<string>();
  const onchainRegistration = useQuery({
    queryKey: ['merchant-registration', MERCHANT_REGISTRY_ADDRESS, address],
    enabled: Boolean(MERCHANT_REGISTRY_ADDRESS && address && publicClient),
    queryFn: async () => {
      const registryAddress = MERCHANT_REGISTRY_ADDRESS;
      if (!registryAddress || !address || !publicClient) return undefined;
      return publicClient.readContract({
        address: registryAddress,
        abi: merchantRegistryAbi,
        functionName: 'getMerchant',
        args: [address],
      });
    },
    refetchInterval: submittedHash ? 2_000 : false,
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

  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Merchant onboarding</h1>
          <p>
            Keep merchant administration, payout, and invoice-signing authority deliberately
            separated.
          </p>
        </div>
      </div>

      <div className="form-grid" style={{ alignItems: 'start' }}>
        <Card className="panel">
          <div className="panel-header">
            <h2>Onchain merchant registration</h2>
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
          <div className="info-banner">
            <ShieldCheck size={17} />
            <span>
              The delegated signer cannot edit payout addresses, split templates, platform fees,
              adapters, or merchant funds.
            </span>
          </div>
        </div>
      </div>
    </>
  );
}
