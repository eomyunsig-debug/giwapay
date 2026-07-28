import type { Address, Hex } from 'viem';

import { GIWA_SEPOLIA_CHAIN_ID } from '@giwapay/chains';

export interface WalletTransaction {
  account: Address;
  to: Address;
  data: Hex;
  value: bigint;
}

interface TransactionSender {
  sendTransaction(transaction: WalletTransaction): Promise<Hex>;
}

export async function ensureGiwaWalletClient<T>(options: {
  chainId: number | undefined;
  walletClient: T | undefined;
  switchChain: () => Promise<unknown>;
  refreshWalletClient: () => Promise<T | undefined>;
}): Promise<T> {
  if (options.chainId !== GIWA_SEPOLIA_CHAIN_ID) {
    await options.switchChain();
  }
  const client =
    options.chainId === GIWA_SEPOLIA_CHAIN_ID && options.walletClient
      ? options.walletClient
      : await options.refreshWalletClient();
  if (!client) {
    throw new Error(
      'Wallet switched networks but a GIWA Sepolia signing client was not available. Reconnect the wallet and try again.',
    );
  }
  return client;
}

/**
 * Narrows wagmi's runtime wallet client to the chain-bound transaction method.
 * Chain switching is completed before this function is called.
 */
export async function sendWalletTransaction(
  client: unknown,
  transaction: WalletTransaction,
): Promise<Hex> {
  return (client as TransactionSender).sendTransaction(transaction);
}
