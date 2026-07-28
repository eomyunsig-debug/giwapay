import { describe, expect, it } from 'vitest';

import { loadConfig } from './env.js';

const base = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/giwapay_test',
  ALLOWED_ORIGINS: 'http://localhost:3000',
  WEB_BASE_URL: 'http://localhost:3000',
  PUBLIC_API_URL: 'http://localhost:3001',
  SESSION_SECRET: 's'.repeat(32),
  API_KEY_PEPPER: 'p'.repeat(32),
  WEBHOOK_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64'),
};

describe('configuration', () => {
  it('locks the application to official GIWA Sepolia chain id', () => {
    expect(() => loadConfig({ ...base, GIWA_CHAIN_ID: '1' })).toThrow(/91342/);
    expect(loadConfig(base).GIWA_CHAIN_ID).toBe(91_342);
  });

  it('hides API documentation by default in production and permits explicit exposure', () => {
    expect(loadConfig({ ...base, NODE_ENV: 'production' }).exposeApiDocs).toBe(false);
    expect(
      loadConfig({ ...base, NODE_ENV: 'production', EXPOSE_API_DOCS: 'true' }).exposeApiDocs,
    ).toBe(true);
    expect(loadConfig(base).exposeApiDocs).toBe(true);
  });

  it('fails when the webhook encryption key is not 32 bytes', () => {
    expect(() => loadConfig({ ...base, WEBHOOK_ENCRYPTION_KEY: 'bad' })).toThrow(/32-byte/);
  });

  it('rejects test adapters in production configuration', () => {
    expect(() =>
      loadConfig({
        ...base,
        NODE_ENV: 'production',
        SUPPORTED_PAYMENT_TOKENS_JSON: JSON.stringify([
          {
            token: '0x0000000000000000000000000000000000000001',
            tokenSymbol: 'MockIN',
            tokenName: 'Testnet Mock Input',
            tokenDecimals: 18,
            settlementToken: '0x0000000000000000000000000000000000000002',
            adapter: '0x0000000000000000000000000000000000000003',
            adapterIdentifier: 'mock',
            testOnly: true,
          },
          {
            token: '0x0000000000000000000000000000000000000002',
            tokenSymbol: 'MockOUT',
            tokenName: 'Testnet Mock Output',
            tokenDecimals: 6,
            settlementToken: '0x0000000000000000000000000000000000000002',
            adapterIdentifier: 'direct',
            testOnly: true,
          },
        ]),
      }),
    ).toThrow(/ALLOW_TEST_CONTRACTS/);
  });

  it('never permits test-only contracts in production', () => {
    expect(() =>
      loadConfig({ ...base, NODE_ENV: 'production', ALLOW_TEST_CONTRACTS: 'true' }),
    ).toThrow(/forbidden in production/);
  });

  it('forbids extractable shared intent-signing keys in production', () => {
    expect(() =>
      loadConfig({
        ...base,
        NODE_ENV: 'production',
        PAYMENT_INTENT_SIGNER_PRIVATE_KEY: `0x${'11'.repeat(32)}`,
      }),
    ).toThrow(/development-only/);
  });

  it('requires distinct per-merchant KMS handles and an AWS region', () => {
    const keys = [
      {
        merchant: `0x${'11'.repeat(20)}`,
        provider: 'aws-kms',
        keyId: 'alias/giwapay-merchant-a',
        address: `0x${'aa'.repeat(20)}`,
      },
      {
        merchant: `0x${'22'.repeat(20)}`,
        provider: 'aws-kms',
        keyId: 'alias/giwapay-merchant-a',
        address: `0x${'bb'.repeat(20)}`,
      },
    ];
    expect(() =>
      loadConfig({
        ...base,
        AWS_REGION: 'ap-northeast-2',
        PAYMENT_INTENT_SIGNER_KEYS_JSON: JSON.stringify(keys),
      }),
    ).toThrow(/must not be shared/);
    expect(() =>
      loadConfig({
        ...base,
        PAYMENT_INTENT_SIGNER_KEYS_JSON: JSON.stringify(keys.slice(0, 1)),
      }),
    ).toThrow(/AWS_REGION/);
  });

  it('rejects chain-bound configuration outside uint256 and token decimals above 36', () => {
    const token = {
      token: '0x0000000000000000000000000000000000000001',
      tokenSymbol: 'TOKEN',
      tokenName: 'Token',
      tokenDecimals: 37,
      settlementToken: '0x0000000000000000000000000000000000000001',
      maxInputCap: (1n << 256n).toString(),
    };
    expect(() =>
      loadConfig({ ...base, SUPPORTED_PAYMENT_TOKENS_JSON: JSON.stringify([token]) }),
    ).toThrow();
  });

  it('accepts only explicit trusted proxy IPs/CIDRs', () => {
    expect(
      loadConfig({
        ...base,
        TRUSTED_PROXY_CIDRS: '127.0.0.1,100.64.0.0/10',
      }).trustedProxyCidrs,
    ).toEqual(['127.0.0.1', '100.64.0.0/10']);
    expect(() => loadConfig({ ...base, TRUSTED_PROXY_CIDRS: '0.0.0.0/0' })).toThrow(/CIDR prefix/);
  });
});
