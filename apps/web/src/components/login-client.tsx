'use client';

import { ArrowRight, ShieldCheck } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { createSiweMessage } from 'viem/siwe';
import { useAccount, useChainId, useSignMessage, useSwitchChain } from 'wagmi';

import { GIWA_SEPOLIA_CHAIN_ID } from '@giwapay/chains';
import { Button, Card } from '@giwapay/ui';
import { giwaPayClient } from '@/lib/api';
import { shortAddress } from '@/lib/format';
import { WalletButton } from './wallet-button';

type SignInStage = 'idle' | 'nonce' | 'signature' | 'verification';

export function LoginClient() {
  const router = useRouter();
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const { switchChainAsync } = useSwitchChain();
  const { signMessageAsync } = useSignMessage();
  const [stage, setStage] = useState<SignInStage>('idle');
  const [error, setError] = useState<string>();

  const signIn = async () => {
    if (!address) return;
    setError(undefined);
    try {
      if (chainId !== GIWA_SEPOLIA_CHAIN_ID) {
        await switchChainAsync({ chainId: GIWA_SEPOLIA_CHAIN_ID });
      }

      setStage('nonce');
      const nonce = await giwaPayClient.createAuthNonce(address);
      const message = createSiweMessage({
        address,
        chainId: nonce.chainId,
        domain: nonce.domain,
        nonce: nonce.nonce,
        uri: nonce.uri,
        version: '1',
        statement: nonce.statement,
        issuedAt: new Date(nonce.issuedAt),
        expirationTime: new Date(nonce.expirationTime),
      });

      setStage('signature');
      const signature = await signMessageAsync({ message });
      setStage('verification');
      const session = await giwaPayClient.verifySiwe({ message, signature });
      if (session.csrfToken) {
        window.sessionStorage.setItem('giwapay.csrf', session.csrfToken);
      }
      router.replace('/dashboard');
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Wallet sign-in failed');
      setStage('idle');
    }
  };

  const buttonText: Record<SignInStage, string> = {
    idle: 'Sign in with Ethereum',
    nonce: 'Preparing secure nonce…',
    signature: 'Check your wallet…',
    verification: 'Verifying signature…',
  };

  return (
    <Card className="login-card">
      <p className="eyebrow">Merchant console</p>
      <h2>판매자 지갑으로 로그인</h2>
      <p>
        Sign a one-time SIWE message. No transaction, token approval, or private key is requested.
      </p>

      <div className="login-wallet">
        <div>
          <strong>{isConnected ? 'Wallet connected' : 'Connect a wallet'}</strong>
          <small>{address ? shortAddress(address) : 'EIP-1193 / EIP-6963 injected wallet'}</small>
        </div>
        <WalletButton compact />
      </div>

      {error ? (
        <p className="gp-field-error" role="alert">
          {error}
        </p>
      ) : null}

      <Button
        size="lg"
        onClick={signIn}
        disabled={!isConnected || !address}
        loading={stage !== 'idle'}
      >
        {buttonText[stage]}
        {stage === 'idle' ? <ArrowRight size={16} /> : null}
      </Button>

      <p className="legal-note">
        <ShieldCheck size={11} style={{ verticalAlign: '-2px' }} /> Non-custodial authentication ·
        nonce expires and can be used only once
      </p>
    </Card>
  );
}
