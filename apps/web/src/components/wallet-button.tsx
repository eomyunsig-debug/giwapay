'use client';

import { Check, ChevronDown, LoaderCircle, LogOut, Wallet } from 'lucide-react';
import { useState } from 'react';
import { useAccount, useConnect, useDisconnect, useSwitchChain } from 'wagmi';

import { GIWA_SEPOLIA_CHAIN_ID } from '@giwapay/chains';
import { shortAddress } from '@/lib/format';
import { useGiwaPayLocale } from './language-toggle';

export function WalletButton({ compact = false }: { compact?: boolean }) {
  const locale = useGiwaPayLocale();
  const text =
    locale === 'ko'
      ? {
          connected: '연결된 지갑',
          switchNetwork: 'GIWA Sepolia로 전환',
          disconnect: '연결 해제',
          connecting: '연결 중…',
          connect: '지갑 연결',
          choose: '지갑 선택',
          install: 'EIP-1193 호환 지갑을 설치하세요.',
        }
      : {
          connected: 'Connected wallet',
          switchNetwork: 'Switch to GIWA Sepolia',
          disconnect: 'Disconnect',
          connecting: 'Connecting…',
          connect: 'Connect wallet',
          choose: 'Choose a wallet',
          install: 'Install an EIP-1193 compatible wallet.',
        };
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
            <p className="popover-label">{text.connected}</p>
            <p className="wallet-address">{address}</p>
            {wrongChain ? (
              <button
                type="button"
                className="popover-action"
                onClick={() => switchChain({ chainId: GIWA_SEPOLIA_CHAIN_ID })}
                disabled={isSwitching}
              >
                <LoaderCircle className={isSwitching ? 'spin' : ''} size={15} />
                {text.switchNetwork}
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
              <LogOut size={15} /> {text.disconnect}
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
        <span>{isPending ? text.connecting : text.connect}</span>
      </button>
      {open ? (
        <div className="wallet-popover wallet-popover--connectors">
          <p className="popover-label">{text.choose}</p>
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
          {connectors.length === 0 ? <p className="popover-empty">{text.install}</p> : null}
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
