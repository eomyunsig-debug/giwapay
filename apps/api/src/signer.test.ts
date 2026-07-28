import { createPublicKey } from 'node:crypto';

import {
  DescribeKeyCommand,
  GetPublicKeyCommand,
  SignCommand,
  type KMSClient,
} from '@aws-sdk/client-kms';
import type { Merchant } from '@giwapay/db';
import { hashTypedData, parseSignature, recoverAddress, toBytes, type Hex } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { describe, expect, it, vi } from 'vitest';

import { paymentIntentTypes, zeroAddress, zeroBytes32 } from './abi.js';
import { loadConfig } from './env.js';
import { parseKmsDerSignature, PaymentIntentSigner, type UnsignedPaymentIntent } from './signer.js';

const router = `0x${'11'.repeat(20)}` as const;
const merchantAddress = `0x${'22'.repeat(20)}` as const;
const token = `0x${'33'.repeat(20)}` as const;

function baseConfig(extra: Record<string, string> = {}) {
  return loadConfig({
    NODE_ENV: 'test',
    DATABASE_URL: 'postgresql://user:pass@localhost:5432/giwapay_test',
    ALLOWED_ORIGINS: 'http://localhost:3000',
    WEB_BASE_URL: 'http://localhost:3000',
    PUBLIC_API_URL: 'http://localhost:3001',
    SESSION_SECRET: 's'.repeat(32),
    API_KEY_PEPPER: 'p'.repeat(32),
    WEBHOOK_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64'),
    PAYMENT_ROUTER_ADDRESS: router,
    ...extra,
  });
}

function message(signer: `0x${string}`): UnsignedPaymentIntent {
  return {
    intentId: `0x${'44'.repeat(32)}`,
    merchant: merchantAddress,
    signer,
    settlementToken: token,
    settlementAmount: 1_000_000n,
    splitId: zeroBytes32,
    splitHash: `0x${'55'.repeat(32)}`,
    platformFee: 5_000n,
    validAfter: 1_800_000_000,
    expiresAt: 1_800_000_300,
    payer: zeroAddress,
    metadataHash: `0x${'66'.repeat(32)}`,
  };
}

function merchant(delegatedSignerAddress: `0x${string}`): Merchant {
  const now = new Date();
  return {
    id: crypto.randomUUID(),
    onchainMerchantAddress: merchantAddress,
    adminAddress: merchantAddress,
    payoutAddress: merchantAddress,
    delegatedSignerAddress,
    refundOperatorAddress: null,
    status: 'active',
    onchainRegisteredAt: now,
    settings: { displayName: 'Signer test merchant' },
    createdAt: now,
    updatedAt: now,
  };
}

function derInteger(value: bigint): Uint8Array {
  let bytes = toBytes(value);
  while (bytes.length > 1 && bytes[0] === 0) bytes = bytes.slice(1);
  if ((bytes[0]! & 0x80) !== 0) bytes = Uint8Array.from([0, ...bytes]);
  return Uint8Array.from([0x02, bytes.length, ...bytes]);
}

function derSignature(signature: Hex): Uint8Array {
  const decoded = parseSignature(signature);
  const r = derInteger(BigInt(decoded.r));
  const s = derInteger(BigInt(decoded.s));
  return Uint8Array.from([0x30, r.length + s.length, ...r, ...s]);
}

function spkiPublicKey(publicKey: Hex): Uint8Array {
  const bytes = toBytes(publicKey);
  const key = createPublicKey({
    key: {
      kty: 'EC',
      crv: 'secp256k1',
      x: Buffer.from(bytes.slice(1, 33)).toString('base64url'),
      y: Buffer.from(bytes.slice(33, 65)).toString('base64url'),
    },
    format: 'jwk',
  });
  return new Uint8Array(key.export({ format: 'der', type: 'spki' }));
}

describe('PaymentIntent signer providers', () => {
  it('caches and uses the development-only local account', async () => {
    const privateKey = generatePrivateKey();
    const account = privateKeyToAccount(privateKey);
    const signer = new PaymentIntentSigner(
      baseConfig({ PAYMENT_INTENT_SIGNER_PRIVATE_KEY: privateKey }),
    );

    expect(signer.addressForMerchant(merchantAddress)).toBe(account.address.toLowerCase());
    expect(await signer.readiness()).toBe(true);
    const signed = await signer.sign(
      merchant(account.address.toLowerCase() as `0x${string}`),
      message(account.address.toLowerCase() as `0x${string}`),
    );
    const digest = hashTypedData({
      domain: signed.domain,
      types: paymentIntentTypes,
      primaryType: 'PaymentIntent',
      message: message(account.address.toLowerCase() as `0x${string}`),
    });
    expect(
      (await recoverAddress({ hash: digest, signature: signed.signature })).toLowerCase(),
    ).toBe(account.address.toLowerCase());
  });

  it('refuses to sign a typed message that names a different signer', async () => {
    const privateKey = generatePrivateKey();
    const account = privateKeyToAccount(privateKey);
    const signer = new PaymentIntentSigner(
      baseConfig({ PAYMENT_INTENT_SIGNER_PRIVATE_KEY: privateKey }),
    );

    await expect(
      signer.sign(merchant(account.address.toLowerCase() as `0x${string}`), message(zeroAddress)),
    ).rejects.toMatchObject({ statusCode: 409, code: 'delegated_signer_mismatch' });
  });

  it('converts a per-merchant AWS KMS DER signature into Ethereum form', async () => {
    const privateKey = generatePrivateKey();
    const account = privateKeyToAccount(privateKey);
    const config = baseConfig({
      AWS_REGION: 'ap-northeast-2',
      AWS_KMS_READINESS_KEY_ID: 'alias/giwapay-readiness',
      PAYMENT_INTENT_SIGNER_KEYS_JSON: JSON.stringify([
        {
          merchant: merchantAddress,
          provider: 'aws-kms',
          keyId: 'alias/giwapay-test-merchant',
          address: account.address,
        },
      ]),
    });
    const fakeKms = {
      send: async (command: SignCommand) => {
        if (!(command instanceof SignCommand) || !command.input.Message) {
          throw new Error('Unexpected KMS command');
        }
        const digest = `0x${Buffer.from(command.input.Message).toString('hex')}` as Hex;
        return { Signature: derSignature(await account.sign({ hash: digest })) };
      },
    } as unknown as KMSClient;
    const signer = new PaymentIntentSigner(config, fakeKms);

    const signed = await signer.sign(
      merchant(account.address.toLowerCase() as `0x${string}`),
      message(account.address.toLowerCase() as `0x${string}`),
    );
    const digest = hashTypedData({
      domain: signed.domain,
      types: paymentIntentTypes,
      primaryType: 'PaymentIntent',
      message: message(account.address.toLowerCase() as `0x${string}`),
    });
    expect(
      (await recoverAddress({ hash: digest, signature: signed.signature })).toLowerCase(),
    ).toBe(account.address.toLowerCase());
  });

  it('bounds failed KMS readiness probes with a short negative TTL', async () => {
    vi.useFakeTimers();
    const privateKey = generatePrivateKey();
    const account = privateKeyToAccount(privateKey);
    const config = baseConfig({
      AWS_REGION: 'ap-northeast-2',
      AWS_KMS_READINESS_KEY_ID: 'alias/giwapay-readiness',
      PAYMENT_INTENT_SIGNER_KEYS_JSON: JSON.stringify([
        {
          merchant: merchantAddress,
          provider: 'aws-kms',
          keyId: 'alias/giwapay-readiness-test',
          address: account.address,
        },
      ]),
    });
    let calls = 0;
    const fakeKms = {
      send: async (command: DescribeKeyCommand) => {
        if (!(command instanceof DescribeKeyCommand)) throw new Error('Unexpected KMS command');
        calls += 1;
        if (calls === 1) throw new Error('transient KMS network failure');
        return {
          KeyMetadata: {
            Enabled: true,
            KeySpec: 'ECC_SECG_P256K1',
            KeyUsage: 'SIGN_VERIFY',
          },
        };
      },
    } as unknown as KMSClient;
    const signer = new PaymentIntentSigner(config, fakeKms);

    try {
      await expect(signer.readiness()).resolves.toBe(false);
      await expect(signer.readiness()).resolves.toBe(false);
      expect(calls).toBe(1);

      await vi.advanceTimersByTimeAsync(3_000);
      await expect(signer.readiness()).resolves.toBe(true);
      await expect(signer.readiness()).resolves.toBe(true);
      expect(calls).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('uses one dedicated KMS probe instead of checking every merchant key', async () => {
    const accountA = privateKeyToAccount(generatePrivateKey());
    const accountB = privateKeyToAccount(generatePrivateKey());
    const merchantB = `0x${'77'.repeat(20)}` as const;
    const config = baseConfig({
      AWS_REGION: 'ap-northeast-2',
      AWS_KMS_READINESS_KEY_ID: 'alias/giwapay-readiness',
      PAYMENT_INTENT_SIGNER_KEYS_JSON: JSON.stringify([
        {
          merchant: merchantAddress,
          provider: 'aws-kms',
          keyId: 'alias/giwapay-merchant-a',
          address: accountA.address,
        },
        {
          merchant: merchantB,
          provider: 'aws-kms',
          keyId: 'alias/giwapay-merchant-b',
          address: accountB.address,
        },
      ]),
    });
    let calls = 0;
    const fakeKms = {
      send: async (command: DescribeKeyCommand) => {
        if (!(command instanceof DescribeKeyCommand)) throw new Error('Unexpected KMS command');
        calls += 1;
        return {
          KeyMetadata: {
            Enabled: true,
            KeySpec: 'ECC_SECG_P256K1',
            KeyUsage: 'SIGN_VERIFY',
          },
        };
      },
    } as unknown as KMSClient;
    const signer = new PaymentIntentSigner(config, fakeKms);

    await expect(Promise.all([signer.readiness(), signer.readiness()])).resolves.toEqual([
      true,
      true,
    ]);
    expect(calls).toBe(1);
  });

  it('verifies the configured merchant key during onboarding', async () => {
    const account = privateKeyToAccount(generatePrivateKey());
    const config = baseConfig({
      AWS_REGION: 'ap-northeast-2',
      AWS_KMS_READINESS_KEY_ID: 'alias/giwapay-readiness',
      PAYMENT_INTENT_SIGNER_KEYS_JSON: JSON.stringify([
        {
          merchant: merchantAddress,
          provider: 'aws-kms',
          keyId: 'alias/giwapay-onboarding-test',
          address: account.address,
        },
      ]),
    });
    let calls = 0;
    const fakeKms = {
      send: async (command: GetPublicKeyCommand) => {
        if (!(command instanceof GetPublicKeyCommand)) throw new Error('Unexpected KMS command');
        calls += 1;
        return {
          KeySpec: 'ECC_SECG_P256K1',
          KeyUsage: 'SIGN_VERIFY',
          PublicKey: spkiPublicKey(account.publicKey),
        };
      },
    } as unknown as KMSClient;
    const signer = new PaymentIntentSigner(config, fakeKms);

    await expect(
      signer.verifyMerchantSigner(merchant(account.address.toLowerCase() as `0x${string}`)),
    ).resolves.toBeUndefined();
    expect(calls).toBe(1);
  });

  it('fails only the merchant whose onboarding key resolves to another address', async () => {
    const configuredAccount = privateKeyToAccount(generatePrivateKey());
    const actualAccount = privateKeyToAccount(generatePrivateKey());
    const config = baseConfig({
      AWS_REGION: 'ap-northeast-2',
      AWS_KMS_READINESS_KEY_ID: 'alias/giwapay-readiness',
      PAYMENT_INTENT_SIGNER_KEYS_JSON: JSON.stringify([
        {
          merchant: merchantAddress,
          provider: 'aws-kms',
          keyId: 'alias/giwapay-mismatched-merchant',
          address: configuredAccount.address,
        },
      ]),
    });
    const fakeKms = {
      send: async (command: GetPublicKeyCommand) => {
        if (!(command instanceof GetPublicKeyCommand)) throw new Error('Unexpected KMS command');
        return {
          KeySpec: 'ECC_SECG_P256K1',
          KeyUsage: 'SIGN_VERIFY',
          PublicKey: spkiPublicKey(actualAccount.publicKey),
        };
      },
    } as unknown as KMSClient;
    const signer = new PaymentIntentSigner(config, fakeKms);

    await expect(
      signer.verifyMerchantSigner(
        merchant(configuredAccount.address.toLowerCase() as `0x${string}`),
      ),
    ).rejects.toMatchObject({ statusCode: 503, code: 'intent_signer_unavailable' });
  });

  it('rejects malformed or out-of-range KMS signatures', () => {
    expect(() => parseKmsDerSignature(Uint8Array.from([0x01, 0x00]))).toThrow(/DER sequence/);
    expect(() =>
      parseKmsDerSignature(Uint8Array.from([0x30, 0x06, 0x02, 0x01, 0x00, 0x02, 0x01, 0x01])),
    ).toThrow(/Invalid KMS/);
  });
});
