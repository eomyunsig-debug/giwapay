import { describe, expect, it, vi } from 'vitest';

import { GIWA_SEPOLIA_CHAIN_ID } from '@giwapay/chains';
import { ensureGiwaWalletClient } from './wallet';

describe('ensureGiwaWalletClient', () => {
  it('switches a wrong-chain wallet before acquiring the GIWA client', async () => {
    const order: string[] = [];
    const client = { chain: GIWA_SEPOLIA_CHAIN_ID };

    await expect(
      ensureGiwaWalletClient({
        chainId: 1,
        walletClient: undefined,
        switchChain: async () => {
          order.push('switch');
        },
        refreshWalletClient: async () => {
          order.push('refresh');
          return client;
        },
      }),
    ).resolves.toBe(client);
    expect(order).toEqual(['switch', 'refresh']);
  });

  it('reuses an already chain-bound client without switching', async () => {
    const client = { chain: GIWA_SEPOLIA_CHAIN_ID };
    const switchChain = vi.fn();
    const refreshWalletClient = vi.fn();

    await expect(
      ensureGiwaWalletClient({
        chainId: GIWA_SEPOLIA_CHAIN_ID,
        walletClient: client,
        switchChain,
        refreshWalletClient,
      }),
    ).resolves.toBe(client);
    expect(switchChain).not.toHaveBeenCalled();
    expect(refreshWalletClient).not.toHaveBeenCalled();
  });
});
