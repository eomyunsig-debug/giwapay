import { describe, expect, it } from 'vitest';

import { loadConfig } from './env.js';
import { assertCachedRouterConfiguration, assertRouterConfiguration } from './router-readiness.js';
import { PaymentIntentSigner } from './signer.js';
import type { AppServices } from './types.js';

const router = '0x0000000000000000000000000000000000000010';
const merchantRegistry = '0x0000000000000000000000000000000000000020';
const adapterRegistry = '0x0000000000000000000000000000000000000030';

function services(feeBps = 50): AppServices {
  const config = loadConfig({
    NODE_ENV: 'test',
    DATABASE_URL: 'postgresql://unused:unused@127.0.0.1:1/unused',
    ALLOWED_ORIGINS: 'http://localhost:3000',
    WEB_BASE_URL: 'http://localhost:3000',
    PUBLIC_API_URL: 'http://localhost:3001',
    SESSION_SECRET: 's'.repeat(32),
    API_KEY_PEPPER: 'p'.repeat(32),
    WEBHOOK_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64'),
    PAYMENT_ROUTER_ADDRESS: router,
    MERCHANT_REGISTRY_ADDRESS: merchantRegistry,
    ADAPTER_REGISTRY_ADDRESS: adapterRegistry,
    PLATFORM_FEE_BPS: String(feeBps),
  });
  const chainClient = {
    readContract: async ({ functionName }: { functionName: string }) => {
      if (functionName === 'platformFeeBps') return 50;
      if (functionName === 'merchantRegistry') return merchantRegistry;
      if (functionName === 'adapterRegistry') return adapterRegistry;
      throw new Error('Unexpected function');
    },
  } as unknown as AppServices['chainClient'];
  return {
    config,
    db: {} as AppServices['db'],
    pool: {} as AppServices['pool'],
    chainClient,
    intentSigner: new PaymentIntentSigner(config),
  };
}

describe('PaymentRouter readiness', () => {
  it('accepts matching immutable fee and registry addresses', async () => {
    await expect(assertRouterConfiguration(services())).resolves.toMatchObject({
      matches: true,
      feeBps: 50,
      merchantRegistry,
      adapterRegistry,
    });
  });

  it('fails closed when configured fee differs from the router', async () => {
    await expect(assertRouterConfiguration(services(75))).rejects.toMatchObject({
      statusCode: 503,
      code: 'router_configuration_mismatch',
    });
  });

  it('coalesces immutable router configuration reads', async () => {
    const target = services();
    let calls = 0;
    const original = target.chainClient.readContract.bind(target.chainClient);
    target.chainClient = {
      ...target.chainClient,
      readContract: async (parameters: Parameters<typeof original>[0]) => {
        calls += 1;
        return original(parameters);
      },
    } as AppServices['chainClient'];

    await Promise.all([
      assertCachedRouterConfiguration(target),
      assertCachedRouterConfiguration(target),
    ]);
    await assertCachedRouterConfiguration(target);
    expect(calls).toBe(3);
  });
});
