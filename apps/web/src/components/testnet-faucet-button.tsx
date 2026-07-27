'use client';

import { Check, Droplets, ExternalLink } from 'lucide-react';
import { useState } from 'react';
import type { Address, Hex } from 'viem';
import { useAccount, usePublicClient, useSwitchChain, useWriteContract } from 'wagmi';

import { GIWA_SEPOLIA_CHAIN_ID } from '@giwapay/chains';
import { mockTokenFaucetAbi } from '@giwapay/sdk';
import { Button } from '@giwapay/ui';
import { MOCK_TOKEN_FAUCET_ADDRESS, transactionExplorerUrl } from '@/lib/config';
import { shortAddress } from '@/lib/format';

export function TestnetFaucetButton({ token, label }: { token?: Address; label?: string }) {
  const { chainId, isConnected } = useAccount();
  const { switchChainAsync } = useSwitchChain();
  const { writeContractAsync } = useWriteContract();
  const publicClient = usePublicClient({ chainId: GIWA_SEPOLIA_CHAIN_ID });
  const [claiming, setClaiming] = useState(false);
  const [hash, setHash] = useState<Hex>();
  const [error, setError] = useState<string>();

  const faucetAddress = MOCK_TOKEN_FAUCET_ADDRESS;
  if (!faucetAddress) return null;
  const explorerUrl = hash ? transactionExplorerUrl(hash) : undefined;

  const claim = async () => {
    if (!token || !publicClient) return;
    setClaiming(true);
    setError(undefined);
    try {
      if (chainId !== GIWA_SEPOLIA_CHAIN_ID) {
        await switchChainAsync({ chainId: GIWA_SEPOLIA_CHAIN_ID });
      }
      const transactionHash = await writeContractAsync({
        address: faucetAddress,
        abi: mockTokenFaucetAbi,
        functionName: 'claim',
        args: [token],
        chainId: GIWA_SEPOLIA_CHAIN_ID,
      });
      const receipt = await publicClient.waitForTransactionReceipt({
        hash: transactionHash,
        confirmations: 1,
      });
      if (receipt.status !== 'success') throw new Error('Faucet claim reverted.');
      setHash(transactionHash);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Faucet claim failed');
    } finally {
      setClaiming(false);
    }
  };

  return (
    <div>
      <Button
        variant="secondary"
        size="sm"
        onClick={claim}
        loading={claiming}
        disabled={!isConnected || !token}
      >
        {hash ? <Check size={13} /> : <Droplets size={13} />}
        {hash ? 'Test token claim mined' : `Claim ${label ?? 'mock token'}`}
      </Button>
      {hash && explorerUrl ? (
        <a
          className="explorer-link"
          href={explorerUrl}
          target="_blank"
          rel="noreferrer"
          style={{ marginLeft: 8, fontSize: 11 }}
        >
          Explorer <ExternalLink size={10} />
        </a>
      ) : hash ? (
        <span className="mono" style={{ marginLeft: 8, fontSize: 11 }}>
          Local Anvil transaction {shortAddress(hash)}
        </span>
      ) : null}
      {error ? (
        <p className="gp-field-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
