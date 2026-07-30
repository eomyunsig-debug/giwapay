import { z } from 'zod';
import {
  GIWA_SEPOLIA_CHAIN_ID,
  GIWA_SEPOLIA_EXPLORER_URL,
  GIWA_SEPOLIA_PUBLIC_RPC_URL,
} from '@giwapay/chains';
import { isIP } from 'node:net';
import { derivePurposeSecret } from './crypto.js';

const address = z
  .string()
  .regex(/^0x[0-9a-fA-F]{40}$/)
  .transform((value) => value.toLowerCase() as `0x${string}`);

const privateKey = z
  .string()
  .regex(/^0x[0-9a-fA-F]{64}$/)
  .transform((value) => value as `0x${string}`);
const paymentIntentSignerKeySchema = z.object({
  merchant: address,
  provider: z.literal('aws-kms'),
  keyId: z.string().trim().min(1).max(2_048),
  address,
});
const maxUint256 = (1n << 256n) - 1n;
const positiveUint256 = z
  .string()
  .regex(/^[1-9][0-9]*$/)
  .refine((value) => BigInt(value) <= maxUint256, 'Value exceeds uint256');

const supportedPaymentTokenSchema = z.object({
  token: address,
  tokenSymbol: z.string().trim().min(1).max(20),
  tokenName: z.string().trim().min(1).max(100),
  tokenDecimals: z.number().int().min(0).max(36),
  settlementToken: address,
  adapter: address.optional(),
  adapterIdentifier: z.string().min(1).max(80).default('direct'),
  adapterData: z
    .string()
    .regex(/^0x(?:[0-9a-fA-F]{2})*$/)
    .default('0x')
    .transform((value) => value as `0x${string}`),
  maxInputCap: positiveUint256.optional(),
  defaultSlippageBps: z.number().int().min(0).max(5_000).default(100),
  testOnly: z.boolean().default(false),
});

function csv(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseTrustedProxies(value: string | undefined): string[] {
  return csv(value).map((entry) => {
    const [address, prefix, extra] = entry.split('/');
    const family = address ? isIP(address) : 0;
    if (!family || extra !== undefined) {
      throw new Error(`Invalid trusted proxy address or CIDR: ${entry}`);
    }
    if (prefix !== undefined) {
      const bits = Number(prefix);
      const maximum = family === 4 ? 32 : 128;
      if (!Number.isInteger(bits) || bits <= 0 || bits > maximum) {
        throw new Error(`Invalid trusted proxy CIDR prefix: ${entry}`);
      }
    }
    return entry;
  });
}

function parsePaymentTokens(value: string | undefined) {
  if (!value) return [];
  const routes = z.array(supportedPaymentTokenSchema).parse(JSON.parse(value));
  const metadata = new Map<
    string,
    { symbol: string; name: string; decimals: number; testOnly: boolean }
  >();
  for (const route of routes) {
    const current = {
      symbol: route.tokenSymbol,
      name: route.tokenName,
      decimals: route.tokenDecimals,
      testOnly: route.testOnly,
    };
    const existing = metadata.get(route.token);
    if (existing && JSON.stringify(existing) !== JSON.stringify(current)) {
      throw new Error(`Conflicting token metadata for ${route.token}`);
    }
    metadata.set(route.token, current);
  }
  for (const route of routes) {
    if (!metadata.has(route.settlementToken)) {
      throw new Error(`Settlement token metadata is missing for ${route.settlementToken}`);
    }
  }
  return routes;
}

function parsePaymentIntentSignerKeys(value: string | undefined) {
  if (!value) return [];
  const keys = z.array(paymentIntentSignerKeySchema).max(10_000).parse(JSON.parse(value));
  const merchants = new Set<string>();
  const keyIds = new Set<string>();
  for (const key of keys) {
    if (merchants.has(key.merchant)) {
      throw new Error(`Duplicate PaymentIntent signer merchant: ${key.merchant}`);
    }
    if (keyIds.has(key.keyId)) {
      throw new Error(`PaymentIntent KMS key must not be shared by merchants: ${key.keyId}`);
    }
    merchants.add(key.merchant);
    keyIds.add(key.keyId);
  }
  return keys;
}

const rawSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().min(1).max(65_535).default(3001),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  EXPOSE_API_DOCS: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),
  DATABASE_URL: z.string().min(1),
  ALLOWED_ORIGINS: z.string().min(1),
  WEB_BASE_URL: z.string().url(),
  PUBLIC_API_URL: z.string().url(),
  SESSION_SECRET: z.string().min(32),
  API_KEY_PEPPER: z.string().min(32),
  WEBHOOK_ENCRYPTION_KEY: z.string().min(1),
  SESSION_COOKIE_DOMAIN: z.string().min(1).optional(),
  TRUSTED_PROXY_CIDRS: z.string().optional(),
  SESSION_TTL_SECONDS: z.coerce.number().int().min(300).max(604_800).default(43_200),
  SIWE_NONCE_TTL_SECONDS: z.coerce.number().int().min(60).max(900).default(300),
  GIWA_CHAIN_ID: z.coerce.number().int().default(GIWA_SEPOLIA_CHAIN_ID),
  GIWA_RPC_URL: z.string().url().default(GIWA_SEPOLIA_PUBLIC_RPC_URL),
  GIWA_RPC_FALLBACK_URLS: z.string().optional(),
  CHAIN_EXPLORER_URL: z.string().default(GIWA_SEPOLIA_EXPLORER_URL),
  RPC_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(60_000).default(10_000),
  RPC_RETRY_COUNT: z.coerce.number().int().min(0).max(10).default(3),
  CHAIN_READ_CACHE_TTL_MS: z.coerce.number().int().min(250).max(10_000).default(2_000),
  ROUTER_CONFIGURATION_CACHE_TTL_MS: z.coerce
    .number()
    .int()
    .min(1_000)
    .max(3_600_000)
    .default(300_000),
  QUOTE_RATE_LIMIT_MAX: z.coerce.number().int().min(1).max(200).default(30),
  PREPARE_RATE_LIMIT_MAX: z.coerce.number().int().min(1).max(200).default(20),
  PAYMENT_ROUTER_ADDRESS: address.optional(),
  MERCHANT_REGISTRY_ADDRESS: address.optional(),
  ADAPTER_REGISTRY_ADDRESS: address.optional(),
  PAYMENT_INTENT_SIGNER_PRIVATE_KEY: privateKey.optional(),
  PAYMENT_INTENT_SIGNER_SOURCE: z.enum(['database', 'environment']).optional(),
  PAYMENT_INTENT_SIGNER_KEYS_JSON: z.string().optional(),
  PAYMENT_INTENT_SIGNER_CACHE_TTL_MS: z.coerce.number().int().min(250).max(60_000).default(5_000),
  AWS_REGION: z.string().trim().min(1).max(100).optional(),
  AWS_KMS_ENDPOINT: z.string().url().optional(),
  AWS_KMS_READINESS_KEY_ID: z.string().trim().min(1).max(2_048).optional(),
  AWS_KMS_TIMEOUT_MS: z.coerce.number().int().min(250).max(30_000).default(3_000),
  PLATFORM_FEE_BPS: z.coerce.number().int().min(0).max(1_000).default(50),
  SUPPORTED_PAYMENT_TOKENS_JSON: z.string().optional(),
  ALLOW_TEST_CONTRACTS: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .default(false),
  CHAIN_START_BLOCK: z
    .string()
    .regex(/^[0-9]+$/)
    .transform(BigInt)
    .default(0n),
  CHAIN_CONFIRMATIONS: z.coerce.number().int().min(1).max(100).default(3),
  INDEXER_BATCH_SIZE: z.coerce.number().int().min(1).max(2_000).default(250),
  INDEXER_POLL_INTERVAL_MS: z.coerce.number().int().min(250).max(60_000).default(2_000),
  REORG_LOOKBACK_BLOCKS: z.coerce.number().int().min(10).max(10_000).default(1_000),
  WEBHOOK_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(20).default(8),
  WEBHOOK_TIMEOUT_MS: z.coerce.number().int().min(500).max(60_000).default(10_000),
  WEBHOOK_POLL_INTERVAL_MS: z.coerce.number().int().min(250).max(60_000).default(1_000),
  API_KEY_LAST_USED_WRITE_INTERVAL_MS: z.coerce
    .number()
    .int()
    .min(60_000)
    .max(3_600_000)
    .default(300_000),
  RETENTION_POLL_INTERVAL_MS: z.coerce
    .number()
    .int()
    .min(60_000)
    .max(86_400_000)
    .default(3_600_000),
  AUTH_RETENTION_DAYS: z.coerce.number().int().min(1).max(90).default(7),
  WEBHOOK_RETENTION_DAYS: z.coerce.number().int().min(7).max(3650).default(90),
  RETENTION_BATCH_SIZE: z.coerce.number().int().min(100).max(10_000).default(1_000),
  SENTRY_DSN: z.string().url().optional(),
  SENTRY_ENVIRONMENT: z.string().max(100).default('development'),
});

export type SupportedPaymentToken = z.infer<typeof supportedPaymentTokenSchema>;

export type AppConfig = ReturnType<typeof loadConfig>;

export function loadConfig(source: NodeJS.ProcessEnv = process.env) {
  const raw = rawSchema.parse(source);
  if (raw.GIWA_CHAIN_ID !== GIWA_SEPOLIA_CHAIN_ID) {
    throw new Error('GIWA_CHAIN_ID must be the official GIWA Sepolia ID 91342');
  }

  const webhookKey = Buffer.from(raw.WEBHOOK_ENCRYPTION_KEY, 'base64');
  if (webhookKey.length !== 32) {
    throw new Error('WEBHOOK_ENCRYPTION_KEY must be a base64-encoded 32-byte key');
  }

  const allowedOrigins = csv(raw.ALLOWED_ORIGINS).map((origin) => new URL(origin).origin);
  if (allowedOrigins.length === 0) {
    throw new Error('At least one ALLOWED_ORIGINS value is required');
  }

  const supportedPaymentTokens = parsePaymentTokens(raw.SUPPORTED_PAYMENT_TOKENS_JSON);
  const paymentIntentSignerKeys = parsePaymentIntentSignerKeys(raw.PAYMENT_INTENT_SIGNER_KEYS_JSON);
  const paymentIntentSignerSource =
    raw.PAYMENT_INTENT_SIGNER_SOURCE ??
    (raw.NODE_ENV === 'production' ? 'database' : 'environment');
  if (raw.NODE_ENV === 'production' && raw.ALLOW_TEST_CONTRACTS) {
    throw new Error('ALLOW_TEST_CONTRACTS=true is forbidden in production');
  }
  if (!raw.ALLOW_TEST_CONTRACTS && supportedPaymentTokens.some((token) => token.testOnly)) {
    throw new Error('Test-only contracts require explicit ALLOW_TEST_CONTRACTS=true');
  }
  if (raw.NODE_ENV === 'production' && raw.PAYMENT_INTENT_SIGNER_PRIVATE_KEY) {
    throw new Error(
      'PAYMENT_INTENT_SIGNER_PRIVATE_KEY is development-only; configure per-merchant AWS KMS keys',
    );
  }
  if (paymentIntentSignerSource === 'database' && paymentIntentSignerKeys.length > 0) {
    throw new Error(
      'PAYMENT_INTENT_SIGNER_KEYS_JSON requires PAYMENT_INTENT_SIGNER_SOURCE=environment',
    );
  }
  if (paymentIntentSignerKeys.length > 0 && !raw.AWS_REGION) {
    throw new Error('AWS_REGION is required when PaymentIntent KMS keys are configured');
  }
  if (paymentIntentSignerKeys.length > 0 && !raw.AWS_KMS_READINESS_KEY_ID) {
    throw new Error(
      'AWS_KMS_READINESS_KEY_ID is required when PaymentIntent KMS keys are configured',
    );
  }
  if (
    raw.AWS_KMS_READINESS_KEY_ID &&
    paymentIntentSignerKeys.some((key) => key.keyId === raw.AWS_KMS_READINESS_KEY_ID)
  ) {
    throw new Error('AWS_KMS_READINESS_KEY_ID must not reuse a merchant signing key');
  }

  return {
    ...raw,
    allowedOrigins,
    trustedProxyCidrs: parseTrustedProxies(raw.TRUSTED_PROXY_CIDRS),
    rpcFallbackUrls: csv(raw.GIWA_RPC_FALLBACK_URLS),
    supportedPaymentTokens,
    paymentIntentSignerKeys,
    paymentIntentSignerSource,
    exposeApiDocs: raw.EXPOSE_API_DOCS ?? raw.NODE_ENV !== 'production',
    sessionSecrets: {
      sessionToken: derivePurposeSecret(raw.SESSION_SECRET, 'session-token'),
      csrf: derivePurposeSecret(raw.SESSION_SECRET, 'csrf'),
      siweNonce: derivePurposeSecret(raw.SESSION_SECRET, 'siwe-nonce'),
      quoteEnvelope: derivePurposeSecret(raw.SESSION_SECRET, 'quote-envelope'),
    },
    webhookKey,
    chainExplorerUrl: raw.CHAIN_EXPLORER_URL.trim()
      ? new URL(raw.CHAIN_EXPLORER_URL).toString().replace(/\/$/, '')
      : null,
  };
}
