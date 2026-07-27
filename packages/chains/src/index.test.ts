import { describe, expect, it, vi } from 'vitest';

import {
  DisabledGasSponsorshipProvider,
  GIWA_SEPOLIA_CHAIN_ID,
  GIWA_SEPOLIA_PUBLIC_RPC_URL,
  createDemoTokenRegistry,
  ensureGiwaSepolia,
  resolveGiwaRpcUrls,
} from './index';

describe('GIWA chain configuration', () => {
  it('uses a configured RPC first and removes duplicates', () => {
    expect(
      resolveGiwaRpcUrls(
        { fallbackUrls: ['https://backup.example', 'https://primary.example'] },
        { GIWA_RPC_URL: 'https://primary.example' },
      ),
    ).toEqual(['https://primary.example', 'https://backup.example']);
    expect(GIWA_SEPOLIA_CHAIN_ID).toBe(91_342);
  });

  it('uses the official rate-limited RPC as a development fallback', () => {
    expect(resolveGiwaRpcUrls()).toEqual([GIWA_SEPOLIA_PUBLIC_RPC_URL]);
  });

  it('adds GIWA Sepolia after a 4902 switch failure', async () => {
    const request = vi
      .fn()
      .mockRejectedValueOnce(Object.assign(new Error('unknown chain'), { code: 4902 }))
      .mockResolvedValueOnce(null);

    await ensureGiwaSepolia({
      request: request as unknown as Parameters<typeof ensureGiwaSepolia>[0]['request'],
    });

    expect(request).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ method: 'wallet_addEthereumChain' }),
    );
  });

  it('does not create unconfigured mock token addresses', () => {
    const registry = createDemoTokenRegistry({});
    expect(registry.size).toBe(0);
  });

  it('matches deployed demo token decimals', () => {
    const registry = createDemoTokenRegistry({
      MockKRW: '0x0000000000000000000000000000000000000001',
      MockUSDC: '0x0000000000000000000000000000000000000002',
      MockALT: '0x0000000000000000000000000000000000000003',
    });
    expect([...registry.values()].map(({ name, decimals }) => ({ name, decimals }))).toEqual([
      { name: 'MockKRW', decimals: 6 },
      { name: 'MockUSDC', decimals: 6 },
      { name: 'MockALT', decimals: 18 },
    ]);
  });

  it('rejects test-only token metadata in production', async () => {
    const { parseTokenRegistryJson } = await import('./index.js');
    expect(() =>
      parseTokenRegistryJson(
        JSON.stringify([
          {
            address: '0x0000000000000000000000000000000000000001',
            symbol: 'TEST',
            name: 'Test token',
            decimals: 18,
            testOnly: true,
          },
        ]),
        { production: true },
      ),
    ).toThrow(/testOnly/);
  });

  it('keeps sponsorship explicitly disabled', async () => {
    const result = await new DisabledGasSponsorshipProvider().sponsor({
      chainId: 91_342,
      from: '0x0000000000000000000000000000000000000001',
      to: '0x0000000000000000000000000000000000000002',
      data: '0x',
    });
    expect(result.sponsored).toBe(false);
  });
});
