'use client';

import { Check, ChevronDown, LoaderCircle, LogOut, Wallet } from 'lucide-react';
import { useState } from 'react';
import { useAccount, useConnect, useDisconnect, useSwitchChain } from 'wagmi';

import { GIWA_SEPOLIA_CHAIN_ID } from '@giwapay/chains';
import { shortAddress } from '@/lib/format';

export function WalletButton({ compact = false }: { compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const { address, isConnected, chainId } = useAccount();
  const { connectors, connect, isPending, error } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChain, isPending: isSwitching } = useSwitchChain();

  if (isConnected && address) {
    const wrongChain = chainId !== GIWA_SEPOLIA_CHAIN_ID;
    return (
      <div className="wallet-menu">
        <button
          type="button"
          className="wallet-pill"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
        >
          <span className={`network-dot ${wrongChain ? 'network-dot--warn' : ''}`} />
          {compact ? shortAddress(address) : `GIWA · ${shortAddress(address)}`}
          <ChevronDown size={14} aria-hidden="true" />
        </button>
        {open ? (
          <div className="wallet-popover">
            <p className="popover-label">Connected wallet</p>
            <p className="wallet-address">{address}</p>
            {wrongChain ? (
              <button
                type="button"
                className="popover-action"
                onClick={() => switchChain({ chainId: GIWA_SEPOLIA_CHAIN_ID })}
                disabled={isSwitching}
              >
                <LoaderCircle className={isSwitching ? 'spin' : ''} size={15} />
                Switch to GIWA Sepolia
              </button>
            ) : (
              <p className="popover-ok">
                <Check size={14} /> GIWA Sepolia
              </p>
            )}
            <button
              type="button"
              className="popover-action popover-action--danger"
              onClick={() => {
                disconnect();
                setOpen(false);
              }}
            >
              <LogOut size={15} /> Disconnect
            </button>
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="wallet-menu">
      <button
        type="button"
        className="wallet-connect"
        onClick={() => setOpen((value) => !value)}
        disabled={isPending}
        aria-expanded={open}
      >
        {isPending ? <LoaderCircle className="spin" size={16} /> : <Wallet size={16} />}
        <span>{isPending ? 'Connecting…' : 'Connect wallet'}</span>
      </button>
      {open ? (
        <div className="wallet-popover wallet-popover--connectors">
          <p className="popover-label">Choose a wallet</p>
          {connectors.map((connector) => (
            <button
              type="button"
              className="connector-row"
              key={connector.uid}
              onClick={() => connect({ connector })}
            >
              <span className="connector-icon">
                <Wallet size={16} />
              </span>
              {connector.name}
            </button>
          ))}
          {connectors.length === 0 ? (
            <p className="popover-empty">Install an EIP-1193 compatible wallet.</p>
          ) : null}
          {error ? (
            <p className="popover-error" role="alert">
              {error.message}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
