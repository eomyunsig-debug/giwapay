import { createPublicKey } from 'node:crypto';

import {
  DescribeKeyCommand,
  GetPublicKeyCommand,
  KMSClient,
  SignCommand,
} from '@aws-sdk/client-kms';
import type { Merchant } from '@giwapay/db';
import {
  bytesToHex,
  hashTypedData,
  recoverAddress,
  serializeSignature,
  toHex,
  type Address,
  type Hex,
} from 'viem';
import { privateKeyToAccount, publicKeyToAddress } from 'viem/accounts';

import { paymentIntentTypes } from './abi.js';
import { AsyncTtlCache } from './cache.js';
import type { AppConfig } from './env.js';
import { HttpError } from './errors.js';
import type { MerchantSignerKey, MerchantSignerKeyStore } from './signer-key-store.js';

export type UnsignedPaymentIntent = {
  intentId: `0x${string}`;
  merchant: `0x${string}`;
  signer: `0x${string}`;
  settlementToken: `0x${string}`;
  settlementAmount: bigint;
  splitId: `0x${string}`;
  splitHash: `0x${string}`;
  platformFee: bigint;
  validAfter: number;
  expiresAt: number;
  payer: `0x${string}`;
  metadataHash: `0x${string}`;
};

type SignedPaymentIntent = {
  address: `0x${string}`;
  domain: {
    readonly name: 'GiwaPay';
    readonly version: '1';
    readonly chainId: number;
    readonly verifyingContract: `0x${string}`;
  };
  types: typeof paymentIntentTypes;
  signature: `0x${string}`;
};

export interface IntentSignerProvider {
  addressForMerchant(merchant: Merchant): Promise<`0x${string}` | undefined>;
  readiness(): Promise<boolean>;
  verifyMerchantSigner(merchant: Merchant): Promise<void>;
  sign(merchant: Merchant, message: UnsignedPaymentIntent): Promise<SignedPaymentIntent>;
}

const secp256k1Order = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
const secp256k1HalfOrder = secp256k1Order / 2n;
const readinessSuccessTtlMs = 30_000;
const readinessFailureTtlMs = 3_000;

function readDerLength(bytes: Uint8Array, offset: number): [number, number] {
  const first = bytes[offset];
  if (first === undefined) throw new Error('Truncated DER length');
  if ((first & 0x80) === 0) return [first, offset + 1];
  const lengthBytes = first & 0x7f;
  if (lengthBytes === 0 || lengthBytes > 2 || offset + lengthBytes >= bytes.length) {
    throw new Error('Unsupported DER length');
  }
  let length = 0;
  for (let index = 0; index < lengthBytes; index += 1) {
    length = length * 256 + bytes[offset + 1 + index]!;
  }
  return [length, offset + 1 + lengthBytes];
}

function readDerInteger(bytes: Uint8Array, offset: number): [bigint, number] {
  if (bytes[offset] !== 0x02) throw new Error('Expected DER integer');
  const [length, valueOffset] = readDerLength(bytes, offset + 1);
  const end = valueOffset + length;
  if (length === 0 || end > bytes.length) throw new Error('Invalid DER integer length');
  let value = 0n;
  for (const byte of bytes.slice(valueOffset, end)) value = value * 256n + BigInt(byte);
  return [value, end];
}

export function parseKmsDerSignature(signature: Uint8Array): { r: bigint; s: bigint } {
  if (signature[0] !== 0x30) throw new Error('Expected DER sequence');
  const [sequenceLength, sequenceOffset] = readDerLength(signature, 1);
  if (sequenceOffset + sequenceLength !== signature.length) {
    throw new Error('Invalid DER sequence length');
  }
  const [r, sOffset] = readDerInteger(signature, sequenceOffset);
  const [rawS, end] = readDerInteger(signature, sOffset);
  if (end !== signature.length || r <= 0n || r >= secp256k1Order) {
    throw new Error('Invalid KMS ECDSA signature');
  }
  if (rawS <= 0n || rawS >= secp256k1Order) {
    throw new Error('Invalid KMS ECDSA signature');
  }
  return { r, s: rawS > secp256k1HalfOrder ? secp256k1Order - rawS : rawS };
}

async function serializeRecoverableSignature(
  digest: Hex,
  derSignature: Uint8Array,
  expectedAddress: Address,
): Promise<Hex> {
  const { r, s } = parseKmsDerSignature(derSignature);
  const signature = {
    r: toHex(r, { size: 32 }),
    s: toHex(s, { size: 32 }),
  } as const;
  for (const yParity of [0, 1] as const) {
    const candidate = { ...signature, yParity };
    const recovered = await recoverAddress({ hash: digest, signature: candidate });
    if (recovered.toLowerCase() === expectedAddress.toLowerCase()) {
      return serializeSignature(candidate);
    }
  }
  throw new Error('KMS signature does not match the configured signer address');
}

export function kmsPublicKeyAddress(publicKey: Uint8Array): Address {
  const key = createPublicKey({
    key: Buffer.from(publicKey),
    format: 'der',
    type: 'spki',
  });
  const jwk = key.export({ format: 'jwk' });
  if (!jwk.x || !jwk.y || jwk.crv !== 'secp256k1') {
    throw new Error('KMS key is not a secp256k1 public key');
  }
  const x = Buffer.from(jwk.x, 'base64url');
  const y = Buffer.from(jwk.y, 'base64url');
  if (x.length !== 32 || y.length !== 32) throw new Error('Invalid KMS public key coordinates');
  return publicKeyToAddress(`0x04${bytesToHex(x).slice(2)}${bytesToHex(y).slice(2)}`);
}

export class PaymentIntentSigner implements IntentSignerProvider {
  readonly #config: AppConfig;
  readonly #localAccount;
  readonly #kmsClient?: KMSClient;
  readonly #kmsKeys: Map<string, { keyId: string; address: `0x${string}` }>;
  readonly #keyStore: MerchantSignerKeyStore | undefined;
  readonly #keyCache = new AsyncTtlCache<MerchantSignerKey | undefined>(10_000);
  #readiness: { promise: Promise<boolean>; expiresAt: number } | undefined;

  public constructor(config: AppConfig, kmsClient?: KMSClient, keyStore?: MerchantSignerKeyStore) {
    this.#config = config;
    this.#keyStore = keyStore;
    this.#localAccount = config.PAYMENT_INTENT_SIGNER_PRIVATE_KEY
      ? privateKeyToAccount(config.PAYMENT_INTENT_SIGNER_PRIVATE_KEY)
      : undefined;
    this.#kmsKeys = new Map(
      config.paymentIntentSignerKeys.map((entry) => [
        entry.merchant,
        { keyId: entry.keyId, address: entry.address },
      ]),
    );
    const usesKms = config.paymentIntentSignerSource === 'database' || this.#kmsKeys.size > 0;
    if (kmsClient) {
      this.#kmsClient = kmsClient;
    } else if (usesKms && config.AWS_REGION) {
      this.#kmsClient = new KMSClient({
        region: config.AWS_REGION!,
        ...(config.AWS_KMS_ENDPOINT ? { endpoint: config.AWS_KMS_ENDPOINT } : {}),
      });
    }
  }

  /** Development-only shared signer address. Prefer addressForMerchant. */
  public get address(): `0x${string}` | undefined {
    return this.#localAccount?.address.toLowerCase() as `0x${string}` | undefined;
  }

  async #kmsKeyForMerchant(merchant: Merchant): Promise<MerchantSignerKey | undefined> {
    if (this.#config.paymentIntentSignerSource === 'environment') {
      const configured = this.#kmsKeys.get(merchant.onchainMerchantAddress.toLowerCase());
      return configured ? { provider: 'aws-kms', ...configured } : undefined;
    }
    if (!this.#keyStore) return undefined;
    try {
      return await this.#keyCache.get(
        merchant.id,
        this.#config.PAYMENT_INTENT_SIGNER_CACHE_TTL_MS,
        () => this.#keyStore!.getByMerchantId(merchant.id),
      );
    } catch (error) {
      throw new HttpError(
        503,
        'intent_signer_unavailable',
        'The merchant signer mapping could not be loaded',
        { cause: error },
      );
    }
  }

  public async addressForMerchant(merchant: Merchant): Promise<`0x${string}` | undefined> {
    const kmsKey = await this.#kmsKeyForMerchant(merchant);
    return (
      kmsKey?.address ?? (this.#localAccount?.address.toLowerCase() as `0x${string}` | undefined)
    );
  }

  public readiness(): Promise<boolean> {
    const now = Date.now();
    if (this.#readiness && this.#readiness.expiresAt > now) {
      return this.#readiness.promise;
    }

    const promise = this.#checkReadiness().then(
      (ready) => {
        if (this.#readiness?.promise !== promise) return ready;
        this.#readiness.expiresAt =
          Date.now() + (ready ? readinessSuccessTtlMs : readinessFailureTtlMs);
        return ready;
      },
      () => {
        if (this.#readiness?.promise === promise) {
          this.#readiness.expiresAt = Date.now() + readinessFailureTtlMs;
        }
        return false;
      },
    );
    this.#readiness = { promise, expiresAt: Number.POSITIVE_INFINITY };
    return promise;
  }

  async #checkReadiness(): Promise<boolean> {
    const usesKms = this.#config.paymentIntentSignerSource === 'database' || this.#kmsKeys.size > 0;
    if (!usesKms) return Boolean(this.#localAccount);
    if (
      this.#config.paymentIntentSignerSource === 'database' &&
      (!this.#keyStore || !(await this.#keyStore.readiness()))
    ) {
      return false;
    }
    if (!this.#kmsClient || !this.#config.AWS_KMS_READINESS_KEY_ID) return false;
    const result = await this.#kmsClient.send(
      new DescribeKeyCommand({ KeyId: this.#config.AWS_KMS_READINESS_KEY_ID }),
      { abortSignal: AbortSignal.timeout(this.#config.AWS_KMS_TIMEOUT_MS) },
    );
    return (
      result.KeyMetadata?.Enabled === true &&
      result.KeyMetadata.KeySpec === 'ECC_SECG_P256K1' &&
      result.KeyMetadata.KeyUsage === 'SIGN_VERIFY'
    );
  }

  public async verifyMerchantSigner(merchant: Merchant): Promise<void> {
    const kmsKey = await this.#kmsKeyForMerchant(merchant);
    const expectedAddress =
      kmsKey?.address ?? (this.#localAccount?.address.toLowerCase() as `0x${string}` | undefined);
    if (!expectedAddress) {
      throw new HttpError(
        503,
        'intent_signer_unavailable',
        'No signer key is configured for this merchant',
      );
    }
    if (!merchant.delegatedSignerAddress || merchant.delegatedSignerAddress !== expectedAddress) {
      throw new HttpError(
        409,
        'delegated_signer_mismatch',
        "The configured signer is not the merchant's verified delegated signer",
      );
    }

    if (!kmsKey) return;
    if (!this.#kmsClient) {
      throw new HttpError(503, 'intent_signer_unavailable', 'AWS KMS is not configured');
    }
    try {
      const result = await this.#kmsClient.send(new GetPublicKeyCommand({ KeyId: kmsKey.keyId }), {
        abortSignal: AbortSignal.timeout(this.#config.AWS_KMS_TIMEOUT_MS),
      });
      if (
        result.KeySpec !== 'ECC_SECG_P256K1' ||
        result.KeyUsage !== 'SIGN_VERIFY' ||
        !result.PublicKey ||
        kmsPublicKeyAddress(result.PublicKey).toLowerCase() !== kmsKey.address
      ) {
        throw new Error('KMS key does not match the configured signer address');
      }
    } catch (error) {
      throw new HttpError(
        503,
        'intent_signer_unavailable',
        'The merchant PaymentIntent signer could not be verified',
        { cause: error },
      );
    }
  }

  public async sign(merchant: Merchant, message: UnsignedPaymentIntent) {
    const routerAddress = this.#config.PAYMENT_ROUTER_ADDRESS;
    const kmsKey = await this.#kmsKeyForMerchant(merchant);
    const expectedAddress =
      kmsKey?.address ?? (this.#localAccount?.address.toLowerCase() as `0x${string}` | undefined);
    if (!expectedAddress || !routerAddress) {
      throw new HttpError(
        503,
        'intent_signer_unavailable',
        'PaymentIntent signing is not configured',
      );
    }

    if (
      !merchant.delegatedSignerAddress ||
      merchant.delegatedSignerAddress !== expectedAddress ||
      message.signer !== expectedAddress
    ) {
      throw new HttpError(
        409,
        'delegated_signer_mismatch',
        "The configured signer is not the merchant's verified delegated signer",
      );
    }

    const domain = {
      name: 'GiwaPay',
      version: '1',
      chainId: this.#config.GIWA_CHAIN_ID,
      verifyingContract: routerAddress,
    } as const;
    let signature: Hex;
    if (kmsKey) {
      if (!this.#kmsClient) {
        throw new HttpError(503, 'intent_signer_unavailable', 'AWS KMS is not configured');
      }
      try {
        const digest = hashTypedData({
          domain,
          types: paymentIntentTypes,
          primaryType: 'PaymentIntent',
          message,
        });
        const response = await this.#kmsClient.send(
          new SignCommand({
            KeyId: kmsKey.keyId,
            Message: Buffer.from(digest.slice(2), 'hex'),
            MessageType: 'DIGEST',
            SigningAlgorithm: 'ECDSA_SHA_256',
          }),
          { abortSignal: AbortSignal.timeout(this.#config.AWS_KMS_TIMEOUT_MS) },
        );
        if (!response.Signature) throw new Error('KMS returned no signature');
        signature = await serializeRecoverableSignature(digest, response.Signature, kmsKey.address);
      } catch (error) {
        throw new HttpError(
          503,
          'intent_signer_unavailable',
          'AWS KMS could not sign this PaymentIntent',
          { cause: error },
        );
      }
    } else if (this.#localAccount) {
      signature = await this.#localAccount.signTypedData({
        domain,
        types: paymentIntentTypes,
        primaryType: 'PaymentIntent',
        message,
      });
    } else {
      throw new HttpError(
        503,
        'intent_signer_unavailable',
        'No signer key is configured for this merchant',
      );
    }

    return {
      address: expectedAddress,
      domain,
      types: paymentIntentTypes,
      signature,
    };
  }
}
