import { randomBytes } from 'node:crypto';

import { and, desc, eq, inArray, merchants, paymentIntents, refundRequests } from '@giwapay/db';
import type { FastifyInstance } from 'fastify';
import QRCode from 'qrcode';
import { encodeAbiParameters, encodeFunctionData, encodePacked, keccak256, toHex } from 'viem';
import { z } from 'zod';

import {
  adapterRegistryAbi,
  erc20Abi,
  exactOutputAdapterAbi,
  merchantRegistryAbi,
  paymentRouterAbi,
  zeroAddress,
  zeroBytes32,
} from '../abi.js';
import { authenticate, protectMutation } from '../auth.js';
import { AsyncTtlCache } from '../cache.js';
import { explorerTransactionUrl, normalizeAddress } from '../chain.js';
import { decodeSignedPayload, encodeSignedPayload } from '../crypto.js';
import { enforceDistributedRateLimit } from '../distributed-rate-limit.js';
import type { SupportedPaymentToken } from '../env.js';
import { HttpError } from '../errors.js';
import { calculatePlatformFee } from '../fees.js';
import { assertCachedRouterConfiguration } from '../router-readiness.js';
import type { UnsignedPaymentIntent } from '../signer.js';
import type { AppServices } from '../types.js';
import { refreshMerchantRegistration } from './merchants.js';

const quoteCaches = new WeakMap<object, AsyncTtlCache<Awaited<ReturnType<typeof loadQuote>>>>();
const settlementCaches = new WeakMap<
  object,
  AsyncTtlCache<Awaited<ReturnType<typeof loadSettlementRecipients>>>
>();

const addressSchema = z
  .string()
  .regex(/^0x[0-9a-fA-F]{40}$/)
  .transform((value) => normalizeAddress(value));
const bytes32Schema = z
  .string()
  .regex(/^0x[0-9a-fA-F]{64}$/)
  .transform((value) => value.toLowerCase() as `0x${string}`);
export const maxUint256 = (1n << 256n) - 1n;
export const uintString = z
  .string()
  .regex(/^[1-9][0-9]*$/)
  .refine((value) => BigInt(value) <= maxUint256, 'Value exceeds uint256');

const createBody = z.object({
  idempotencyKey: z.string().trim().min(8).max(255),
  description: z.string().trim().min(1).max(500),
  settlementToken: addressSchema,
  settlementAmount: uintString,
  splitId: bytes32Schema.default(zeroBytes32),
  validAfter: z.iso.datetime().optional(),
  expiresAt: z.iso.datetime(),
  payer: addressSchema.default(zeroAddress),
  metadata: z.record(z.string().max(64), z.string().max(500)).default({}),
});

const idParams = z.object({ id: z.uuid() });
const refundParams = z.object({ id: z.uuid(), refundId: bytes32Schema });
const listQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).max(10_000).default(0),
});
const quoteQuery = z.object({
  tokenIn: addressSchema,
  slippageBps: z.coerce.number().int().min(0).max(5_000).optional(),
});
const prepareBody = z.object({
  tokenIn: addressSchema,
  quoteId: z.string().min(32).max(4_096),
  slippageBps: z.number().int().min(0).max(5_000).optional(),
});
const quoteEnvelopeSchema = z.object({
  version: z.literal(1),
  paymentIntentId: z.uuid(),
  paymentId: bytes32Schema,
  tokenIn: addressSchema,
  estimatedInputAmount: uintString,
  maximumInputAmount: uintString,
  slippageBps: z.number().int().min(0).max(5_000),
  adapter: addressSchema,
  adapterIdentifier: z.string().min(1).max(80),
  settlementRecipients: z
    .array(
      z.object({
        address: addressSchema,
        basisPoints: z.number().int().positive().max(10_000),
      }),
    )
    .min(1)
    .max(8),
  quotedAt: z.number().int().positive(),
  expiresAt: z.number().int().positive(),
});
const refundBody = z.object({
  amount: uintString,
  reason: z.string().trim().max(500).optional(),
  idempotencyKey: z.string().trim().min(8).max(255),
});

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function createBytes32(): `0x${string}` {
  return `0x${randomBytes(32).toString('hex')}`;
}

export function toChainTimestamp(value: Date): Date {
  return new Date(Math.floor(value.getTime() / 1_000) * 1_000);
}

function assertIntentIdempotencyMatch(
  existing: typeof paymentIntents.$inferSelect,
  body: z.infer<typeof createBody>,
  metadataHash: `0x${string}`,
  platformFee: bigint,
) {
  const matches =
    existing.description === body.description &&
    existing.settlementToken === body.settlementToken &&
    existing.settlementAmount === body.settlementAmount &&
    existing.splitId === body.splitId &&
    existing.payerRestriction === body.payer &&
    existing.metadataHash === metadataHash &&
    existing.platformFee === platformFee.toString() &&
    existing.expiresAt.getTime() === toChainTimestamp(new Date(body.expiresAt)).getTime() &&
    (!body.validAfter ||
      existing.validAfter.getTime() === toChainTimestamp(new Date(body.validAfter)).getTime());
  if (!matches) {
    throw new HttpError(
      409,
      'idempotency_key_conflict',
      'Idempotency key was already used with different PaymentIntent parameters',
    );
  }
}

function statusFor(intent: typeof paymentIntents.$inferSelect): typeof intent.status {
  return intent.status === 'created' && intent.expiresAt <= new Date() ? 'expired' : intent.status;
}

export function calculateSplitHash(
  recipients: readonly { address: string; basisPoints: number }[],
): `0x${string}` {
  return keccak256(
    encodeAbiParameters(
      [{ type: 'address[]' }, { type: 'uint16[]' }],
      [
        recipients.map((recipient) => normalizeAddress(recipient.address)),
        recipients.map((recipient) => recipient.basisPoints),
      ],
    ),
  );
}

function signedSplitHash(intent: typeof paymentIntents.$inferSelect): `0x${string}` {
  const result = bytes32Schema.safeParse(intent.typedData.message.splitHash);
  if (!result.success) {
    throw new HttpError(
      500,
      'payment_intent_corrupt',
      'Stored PaymentIntent is missing its signed settlement split hash',
    );
  }
  return result.data;
}

function signedMerchant(intent: typeof paymentIntents.$inferSelect): `0x${string}` {
  const result = addressSchema.safeParse(intent.typedData.message.merchant);
  if (!result.success) {
    throw new HttpError(
      500,
      'payment_intent_corrupt',
      'Stored PaymentIntent is missing its signed merchant address',
    );
  }
  return result.data;
}

function signedSigner(intent: typeof paymentIntents.$inferSelect): `0x${string}` {
  const result = addressSchema.safeParse(intent.typedData.message.signer);
  if (!result.success || result.data !== intent.signerAddress) {
    throw new HttpError(
      500,
      'payment_intent_corrupt',
      'Stored PaymentIntent signer does not match its signed signer address',
    );
  }
  return result.data;
}

function assertSplitMatches(
  intent: typeof paymentIntents.$inferSelect,
  recipients: readonly { address: string; basisPoints: number }[],
) {
  if (calculateSplitHash(recipients) !== signedSplitHash(intent)) {
    throw new HttpError(
      409,
      'split_template_changed',
      'The signed settlement recipients no longer match the on-chain split template',
    );
  }
}

function serializePaymentIntent(
  intent: typeof paymentIntents.$inferSelect,
  merchant?: {
    settings: { displayName: string };
    payoutAddress: string;
  },
  settlementRecipients?: readonly {
    address: string;
    basisPoints: number;
    amount?: string;
  }[],
  explorerBaseUrl: string | null = null,
) {
  return {
    id: intent.id,
    paymentId: intent.paymentId,
    status: statusFor(intent),
    merchant: merchant
      ? {
          name: merchant.settings.displayName,
          payoutAddress: merchant.payoutAddress,
        }
      : undefined,
    description: intent.description,
    settlement: {
      token: intent.settlementToken,
      amount: intent.settlementAmount,
    },
    splitId: intent.splitId,
    splitHash: signedSplitHash(intent),
    settlementRecipients:
      settlementRecipients ?? intent.settlementRecipients ?? intent.expectedSettlementRecipients,
    platformFee: intent.platformFee,
    validAfter: intent.validAfter.toISOString(),
    expiresAt: intent.expiresAt.toISOString(),
    payerRestriction: intent.payerRestriction,
    chainId: intent.chainId,
    routerAddress: intent.routerAddress,
    signerAddress: intent.signerAddress,
    signature: intent.signature,
    typedData: intent.typedData,
    payment: intent.paymentTransactionHash
      ? {
          payer: intent.payerAddress,
          inputToken: intent.inputToken,
          inputAmount: intent.inputAmount,
          platformFee: intent.platformFeeAmount,
          transactionHash: intent.paymentTransactionHash,
          explorerUrl: explorerTransactionUrl(
            intent.paymentTransactionHash as `0x${string}`,
            explorerBaseUrl,
          ),
          blockNumber: intent.paymentBlockNumber?.toString() ?? null,
          blockHash: intent.paymentBlockHash,
          logIndex: intent.paymentLogIndex,
          verifiedAt: intent.chainVerifiedAt?.toISOString() ?? null,
        }
      : null,
    refundedAmount: intent.refundedAmount,
    createdAt: intent.createdAt.toISOString(),
    updatedAt: intent.updatedAt.toISOString(),
  };
}

function findPaymentOption(
  services: AppServices,
  tokenIn: `0x${string}`,
  settlementToken: string,
): SupportedPaymentToken {
  const option = services.config.supportedPaymentTokens.find(
    (entry) => entry.token === tokenIn && entry.settlementToken === settlementToken,
  );
  if (!option) {
    throw new HttpError(
      400,
      'payment_asset_unsupported',
      'The selected payment asset is not supported for this settlement token',
    );
  }
  return option;
}

async function loadQuote(
  services: AppServices,
  intent: typeof paymentIntents.$inferSelect,
  tokenIn: `0x${string}`,
  requestedSlippageBps?: number,
) {
  const option = findPaymentOption(services, tokenIn, intent.settlementToken);
  const exactOutput = BigInt(intent.settlementAmount) + BigInt(intent.platformFee);
  if (exactOutput > maxUint256) {
    throw new HttpError(422, 'payment_amount_overflow', 'Payment amount exceeds uint256');
  }
  const direct = tokenIn === intent.settlementToken && !option.adapter;
  let estimatedAmount: bigint;
  if (direct) {
    estimatedAmount = exactOutput;
  } else {
    if (!option.adapter) {
      throw new HttpError(
        503,
        'adapter_not_configured',
        'An exact-output adapter is required for this pair',
      );
    }
    try {
      estimatedAmount = await services.chainClient.readContract({
        address: option.adapter,
        abi: exactOutputAdapterAbi,
        functionName: 'quoteExactOutput',
        args: [tokenIn, intent.settlementToken as `0x${string}`, exactOutput, option.adapterData],
      });
    } catch {
      throw new HttpError(
        503,
        'quote_unavailable',
        'An independently verified on-chain quote is currently unavailable',
      );
    }
  }
  const slippageBps = requestedSlippageBps ?? option.defaultSlippageBps;
  if (estimatedAmount <= 0n) {
    throw new HttpError(503, 'quote_invalid', 'Adapter returned an invalid zero input quote');
  }
  const maximumAmount = (estimatedAmount * BigInt(10_000 + slippageBps) + 9_999n) / 10_000n;
  if (estimatedAmount > maxUint256 || maximumAmount > maxUint256) {
    throw new HttpError(422, 'quote_amount_overflow', 'Quoted input amount exceeds uint256');
  }
  if (option.maxInputCap && maximumAmount > BigInt(option.maxInputCap)) {
    throw new HttpError(
      422,
      'adapter_input_cap_exceeded',
      'The quote exceeds the configured adapter input cap',
    );
  }
  if (!direct) {
    const registry = services.config.ADAPTER_REGISTRY_ADDRESS;
    if (!registry || !option.adapter) {
      throw new HttpError(503, 'adapter_registry_unavailable', 'AdapterRegistry is not configured');
    }
    try {
      const adapterConfig = await services.chainClient.readContract({
        address: registry,
        abi: adapterRegistryAbi,
        functionName: 'getAdapter',
        args: [option.adapter],
      });
      if (
        !adapterConfig.enabled ||
        adapterConfig.identifier !== option.adapterIdentifier ||
        adapterConfig.testOnly !== option.testOnly
      ) {
        throw new Error('Configured adapter metadata does not match registry');
      }
      await services.chainClient.readContract({
        address: registry,
        abi: adapterRegistryAbi,
        functionName: 'validateAdapter',
        args: [option.adapter, tokenIn, intent.settlementToken as `0x${string}`, maximumAmount],
      });
    } catch {
      throw new HttpError(
        503,
        'adapter_registry_validation_failed',
        'Adapter is not currently enabled and valid for this exact route',
      );
    }
  }
  return {
    option,
    direct,
    estimatedAmount,
    maximumAmount,
    slippageBps,
    quotedAt: new Date(),
  };
}

async function calculateQuote(
  services: AppServices,
  intent: typeof paymentIntents.$inferSelect,
  tokenIn: `0x${string}`,
  requestedSlippageBps?: number,
) {
  let cache = quoteCaches.get(services.chainClient);
  if (!cache) {
    cache = new AsyncTtlCache(10_000);
    quoteCaches.set(services.chainClient, cache);
  }
  return cache.get(
    `${intent.id}:${tokenIn}:${requestedSlippageBps ?? 'default'}`,
    services.config.CHAIN_READ_CACHE_TTL_MS,
    () => loadQuote(services, intent, tokenIn, requestedSlippageBps),
  );
}

async function loadSettlementRecipients(
  services: AppServices,
  merchantAddress: `0x${string}`,
  splitId: `0x${string}`,
  requireEnabled = true,
) {
  const registry = services.config.MERCHANT_REGISTRY_ADDRESS;
  if (!registry) {
    throw new HttpError(503, 'merchant_registry_unavailable', 'MerchantRegistry is not configured');
  }
  try {
    const head = await services.chainClient.getBlockNumber();
    const confirmations = BigInt(services.config.CHAIN_CONFIRMATIONS);
    if (head < confirmations) throw new Error('Insufficient confirmed blocks');
    const [recipients, basisPoints, enabled] = await services.chainClient.readContract({
      address: registry,
      abi: merchantRegistryAbi,
      functionName: 'getSplitTemplate',
      args: [merchantAddress, splitId],
      blockNumber: head - confirmations,
    });
    const total = basisPoints.reduce((sum, value) => sum + value, 0);
    if (
      (requireEnabled && !enabled) ||
      recipients.length === 0 ||
      recipients.length > 8 ||
      recipients.length !== basisPoints.length ||
      total !== 10_000 ||
      recipients.some((recipient) => normalizeAddress(recipient) === zeroAddress) ||
      basisPoints.some((value) => value === 0) ||
      new Set(recipients.map((recipient) => normalizeAddress(recipient))).size !== recipients.length
    ) {
      throw new Error('Split template failed canonical validation');
    }
    return recipients.map((recipient, index) => ({
      address: normalizeAddress(recipient),
      basisPoints: basisPoints[index]!,
    }));
  } catch {
    throw new HttpError(
      409,
      'split_template_invalid',
      'The settlement split is unavailable, disabled, or invalid on-chain',
    );
  }
}

async function getSettlementRecipients(
  services: AppServices,
  merchantAddress: `0x${string}`,
  splitId: `0x${string}`,
  requireEnabled = true,
) {
  let cache = settlementCaches.get(services.chainClient);
  if (!cache) {
    cache = new AsyncTtlCache(10_000);
    settlementCaches.set(services.chainClient, cache);
  }
  return cache.get(
    `${merchantAddress}:${splitId}:${requireEnabled}`,
    services.config.CHAIN_READ_CACHE_TTL_MS,
    () => loadSettlementRecipients(services, merchantAddress, splitId, requireEnabled),
  );
}

export async function registerPaymentIntentRoutes(app: FastifyInstance, services: AppServices) {
  app.get(
    '/v1/payment-intents',
    {
      preHandler: [authenticate(services, 'payment_intents:read')],
      schema: {
        tags: ['Payment intents'],
        summary: 'List merchant payment intents',
        querystring: listQuery,
      },
    },
    async (request) => {
      const principal = request.principal;
      if (!principal) throw new Error('Authentication pre-handler did not run');
      const query = listQuery.parse(request.query);
      const rows = await services.db
        .select()
        .from(paymentIntents)
        .where(eq(paymentIntents.merchantId, principal.merchantId))
        .orderBy(desc(paymentIntents.createdAt))
        .limit(query.limit)
        .offset(query.offset);
      return {
        data: rows.map((intent) =>
          serializePaymentIntent(
            intent,
            principal.merchant,
            intent.settlementRecipients ?? intent.expectedSettlementRecipients,
            services.config.chainExplorerUrl,
          ),
        ),
        pagination: {
          limit: query.limit,
          offset: query.offset,
          hasMore: rows.length === query.limit,
        },
      };
    },
  );

  app.post(
    '/v1/payment-intents',
    {
      preHandler: [authenticate(services, 'payment_intents:write'), protectMutation(services)],
      schema: {
        tags: ['Payment intents'],
        summary: 'Create and sign a PaymentIntent',
        body: createBody,
      },
    },
    async (request, reply) => {
      const principal = request.principal;
      if (!principal) throw new Error('Authentication pre-handler did not run');
      const body = createBody.parse(request.body);
      await assertCachedRouterConfiguration(services);
      const headerKey = request.headers['idempotency-key'];
      if (typeof headerKey === 'string' && headerKey !== body.idempotencyKey) {
        throw new HttpError(
          400,
          'idempotency_key_mismatch',
          'Body and header idempotency keys do not match',
        );
      }
      const requestedAmount = BigInt(body.settlementAmount);
      const requestedPlatformFee = calculatePlatformFee(
        requestedAmount,
        services.config.PLATFORM_FEE_BPS,
      );
      if (requestedAmount + requestedPlatformFee > maxUint256) {
        throw new HttpError(
          400,
          'payment_amount_overflow',
          'Settlement amount plus platform fee exceeds uint256',
        );
      }
      const requestedMetadataHash = keccak256(
        toHex(
          stableJson({
            description: body.description,
            metadata: body.metadata,
          }),
        ),
      );
      const [existing] = await services.db
        .select()
        .from(paymentIntents)
        .where(
          and(
            eq(paymentIntents.merchantId, principal.merchantId),
            eq(paymentIntents.idempotencyKey, body.idempotencyKey),
          ),
        )
        .limit(1);
      if (existing) {
        assertIntentIdempotencyMatch(existing, body, requestedMetadataHash, requestedPlatformFee);
        const checkoutUrl = `${services.config.WEB_BASE_URL}/checkout/${existing.id}`;
        const settlementRecipients =
          existing.settlementRecipients ?? existing.expectedSettlementRecipients;
        return {
          paymentIntent: serializePaymentIntent(
            existing,
            principal.merchant,
            settlementRecipients,
            services.config.chainExplorerUrl,
          ),
          checkoutUrl,
          qrCodeDataUrl: await QRCode.toDataURL(checkoutUrl, {
            errorCorrectionLevel: 'M',
            margin: 1,
            width: 320,
          }),
          idempotentReplay: true,
        };
      }

      const merchant = await refreshMerchantRegistration(services, principal.merchant);
      if (merchant.status !== 'active') {
        throw new HttpError(409, 'merchant_inactive', 'The merchant is not active on-chain');
      }
      const settlementRecipients = await getSettlementRecipients(
        services,
        merchant.onchainMerchantAddress as `0x${string}`,
        body.splitId,
      );
      const splitHash = calculateSplitHash(settlementRecipients);
      if (
        !services.config.supportedPaymentTokens.some(
          (entry) => entry.settlementToken === body.settlementToken,
        )
      ) {
        throw new HttpError(
          400,
          'settlement_token_unsupported',
          'Settlement token is not configured',
        );
      }
      const now = new Date();
      const validAfter = toChainTimestamp(body.validAfter ? new Date(body.validAfter) : now);
      const expiresAt = toChainTimestamp(new Date(body.expiresAt));
      if (
        validAfter.getTime() > now.getTime() + 24 * 60 * 60 * 1_000 ||
        expiresAt.getTime() < Math.max(now.getTime(), validAfter.getTime()) + 60_000 ||
        expiresAt.getTime() > now.getTime() + 7 * 24 * 60 * 60 * 1_000
      ) {
        throw new HttpError(
          400,
          'payment_window_invalid',
          'Payment window must be valid and expire within seven days',
        );
      }
      const settlementAmount = requestedAmount;
      const platformFee = requestedPlatformFee;
      const intentId = keccak256(
        encodePacked(
          ['address', 'string', 'bytes32'],
          [merchant.onchainMerchantAddress as `0x${string}`, body.idempotencyKey, createBytes32()],
        ),
      );
      const metadataHash = requestedMetadataHash;
      const signerAddress = await services.intentSigner.addressForMerchant(merchant);
      if (!signerAddress) {
        throw new HttpError(
          503,
          'intent_signer_unavailable',
          'PaymentIntent signing is not configured for this merchant',
        );
      }
      const unsigned: UnsignedPaymentIntent = {
        intentId,
        merchant: merchant.onchainMerchantAddress as `0x${string}`,
        signer: signerAddress,
        settlementToken: body.settlementToken,
        settlementAmount,
        splitId: body.splitId,
        splitHash,
        platformFee,
        validAfter: Math.floor(validAfter.getTime() / 1_000),
        expiresAt: Math.floor(expiresAt.getTime() / 1_000),
        payer: body.payer,
        metadataHash,
      };
      const signed = await services.intentSigner.sign(merchant, unsigned);
      const typedData = {
        domain: signed.domain,
        primaryType: 'PaymentIntent' as const,
        types: signed.types,
        message: {
          intentId,
          merchant: merchant.onchainMerchantAddress,
          signer: signerAddress,
          settlementToken: body.settlementToken,
          settlementAmount: settlementAmount.toString(),
          splitId: body.splitId,
          splitHash,
          platformFee: platformFee.toString(),
          validAfter: unsigned.validAfter,
          expiresAt: unsigned.expiresAt,
          payer: body.payer,
          metadataHash,
        },
      };
      const [created] = await services.db
        .insert(paymentIntents)
        .values({
          paymentId: intentId,
          merchantId: merchant.id,
          idempotencyKey: body.idempotencyKey,
          description: body.description,
          settlementToken: body.settlementToken,
          settlementAmount: settlementAmount.toString(),
          splitId: body.splitId,
          platformFee: platformFee.toString(),
          validAfter,
          payerRestriction: body.payer,
          metadataHash,
          chainId: services.config.GIWA_CHAIN_ID,
          routerAddress: services.config.PAYMENT_ROUTER_ADDRESS!,
          signerAddress: signed.address,
          signature: signed.signature,
          typedData,
          expiresAt,
          metadata: body.metadata,
          expectedSettlementRecipients: settlementRecipients,
        })
        .onConflictDoNothing()
        .returning();
      const intent =
        created ??
        (
          await services.db
            .select()
            .from(paymentIntents)
            .where(
              and(
                eq(paymentIntents.merchantId, merchant.id),
                eq(paymentIntents.idempotencyKey, body.idempotencyKey),
              ),
            )
            .limit(1)
        )[0];
      if (!intent) throw new Error('PaymentIntent insert did not return a row');
      assertIntentIdempotencyMatch(intent, body, requestedMetadataHash, requestedPlatformFee);
      const checkoutUrl = `${services.config.WEB_BASE_URL}/checkout/${intent.id}`;
      reply.code(created ? 201 : 200);
      return {
        paymentIntent: serializePaymentIntent(
          intent,
          merchant,
          settlementRecipients,
          services.config.chainExplorerUrl,
        ),
        checkoutUrl,
        qrCodeDataUrl: await QRCode.toDataURL(checkoutUrl, {
          errorCorrectionLevel: 'M',
          margin: 1,
          width: 320,
        }),
        idempotentReplay: !created,
      };
    },
  );

  app.get(
    '/v1/payment-intents/:id',
    {
      schema: {
        tags: ['Payment intents'],
        summary: 'Get public checkout and chain-verified status',
        params: idParams,
      },
    },
    async (request) => {
      const { id } = idParams.parse(request.params);
      const [row] = await services.db
        .select({
          intent: paymentIntents,
          merchant: {
            settings: merchants.settings,
            payoutAddress: merchants.payoutAddress,
            adminAddress: merchants.adminAddress,
          },
        })
        .from(paymentIntents)
        .innerJoin(merchants, eq(merchants.id, paymentIntents.merchantId))
        .where(eq(paymentIntents.id, id))
        .limit(1);
      if (!row) {
        throw new HttpError(404, 'payment_intent_not_found', 'PaymentIntent was not found');
      }
      const refunds = await services.db
        .select()
        .from(refundRequests)
        .where(
          and(
            eq(refundRequests.paymentIntentId, row.intent.id),
            eq(refundRequests.status, 'succeeded'),
          ),
        )
        .orderBy(desc(refundRequests.createdAt));
      const settlementRecipients =
        row.intent.settlementRecipients ?? row.intent.expectedSettlementRecipients;
      return {
        paymentIntent: serializePaymentIntent(
          row.intent,
          row.merchant,
          settlementRecipients,
          services.config.chainExplorerUrl,
        ),
        refunds: refunds.map((refund) =>
          serializePublicRefund(refund, services.config.chainExplorerUrl),
        ),
      };
    },
  );

  app.get(
    '/v1/payment-intents/:id/refunds',
    {
      preHandler: [authenticate(services, 'payment_intents:read')],
      schema: {
        tags: ['Refunds'],
        summary: 'List merchant-private refund details',
        params: idParams,
      },
    },
    async (request) => {
      const principal = request.principal;
      if (!principal) throw new Error('Authentication pre-handler did not run');
      const { id } = idParams.parse(request.params);
      const [intent] = await services.db
        .select({ id: paymentIntents.id })
        .from(paymentIntents)
        .where(and(eq(paymentIntents.id, id), eq(paymentIntents.merchantId, principal.merchantId)))
        .limit(1);
      if (!intent) {
        throw new HttpError(404, 'payment_intent_not_found', 'PaymentIntent was not found');
      }
      const refunds = await services.db
        .select()
        .from(refundRequests)
        .where(eq(refundRequests.paymentIntentId, intent.id))
        .orderBy(desc(refundRequests.createdAt));
      return {
        data: refunds.map((refund) => ({
          ...serializePublicRefund(refund, services.config.chainExplorerUrl),
          reason: refund.reason,
        })),
      };
    },
  );

  app.get(
    '/v1/payment-intents/:id/quote',
    {
      schema: {
        tags: ['Checkout'],
        summary: 'Quote an exact-output payment option on-chain',
        params: idParams,
        querystring: quoteQuery,
      },
      config: {
        rateLimit: {
          max: services.config.QUOTE_RATE_LIMIT_MAX,
          timeWindow: '1 minute',
          keyGenerator: (request) =>
            `${request.ip}:${String((request.params as { id?: string }).id ?? 'invalid')}`,
        },
      },
    },
    async (request) => {
      const { id } = idParams.parse(request.params);
      await enforceDistributedRateLimit(services, {
        scope: 'quote',
        identity: `${request.ip}:${id}`,
        maximum: services.config.QUOTE_RATE_LIMIT_MAX,
      });
      const query = quoteQuery.parse(request.query);
      const intent = await getPayableIntent(services, id);
      await assertCachedRouterConfiguration(services);
      const merchant = await getActiveIntentMerchant(services, intent);
      const quote = await calculateQuote(services, intent, query.tokenIn, query.slippageBps);
      const recipients = await getSettlementRecipients(
        services,
        merchant.onchainMerchantAddress as `0x${string}`,
        intent.splitId as `0x${string}`,
      );
      assertSplitMatches(intent, recipients);
      return issueQuote(services, intent, query.tokenIn, quote, recipients);
    },
  );

  app.post(
    '/v1/payment-intents/:id/prepare',
    {
      schema: {
        tags: ['Checkout'],
        summary: 'Build approval and PaymentRouter calldata from a live quote',
        params: idParams,
        body: prepareBody,
      },
      config: {
        rateLimit: {
          max: services.config.PREPARE_RATE_LIMIT_MAX,
          timeWindow: '1 minute',
          keyGenerator: (request) =>
            `${request.ip}:${String((request.params as { id?: string }).id ?? 'invalid')}`,
        },
      },
    },
    async (request) => {
      const { id } = idParams.parse(request.params);
      await enforceDistributedRateLimit(services, {
        scope: 'prepare',
        identity: `${request.ip}:${id}`,
        maximum: services.config.PREPARE_RATE_LIMIT_MAX,
      });
      const body = prepareBody.parse(request.body);
      const intent = await getPayableIntent(services, id);
      const envelopeResult = quoteEnvelopeSchema.safeParse(
        decodeSignedPayload(body.quoteId, services.config.sessionSecrets.quoteEnvelope),
      );
      if (!envelopeResult.success) {
        throw new HttpError(
          409,
          'quote_invalid',
          'Quote is invalid or was not issued by this GiwaPay API',
        );
      }
      const envelope = envelopeResult.data;
      if (
        envelope.expiresAt <= Date.now() ||
        envelope.paymentIntentId !== intent.id ||
        envelope.paymentId !== intent.paymentId ||
        envelope.tokenIn !== body.tokenIn ||
        (body.slippageBps !== undefined && body.slippageBps !== envelope.slippageBps)
      ) {
        throw new HttpError(
          409,
          'quote_expired_or_mismatched',
          'Quote expired or does not match this payment request',
        );
      }
      await assertCachedRouterConfiguration(services);
      const merchant = await getActiveIntentMerchant(services, intent);
      const quote = await calculateQuote(services, intent, body.tokenIn, envelope.slippageBps);
      const recipients = await getSettlementRecipients(
        services,
        merchant.onchainMerchantAddress as `0x${string}`,
        intent.splitId as `0x${string}`,
      );
      assertSplitMatches(intent, recipients);
      const currentAdapter = quote.option.adapter ?? zeroAddress;
      if (
        envelope.estimatedInputAmount !== quote.estimatedAmount.toString() ||
        envelope.maximumInputAmount !== quote.maximumAmount.toString() ||
        envelope.adapter !== currentAdapter ||
        envelope.adapterIdentifier !== quote.option.adapterIdentifier ||
        stableJson(envelope.settlementRecipients) !== stableJson(recipients)
      ) {
        throw new HttpError(
          409,
          'quote_terms_changed',
          'Quote economics or settlement recipients changed; request and review a new quote',
        );
      }
      const maximumAmount = BigInt(envelope.maximumInputAmount);
      const router = intent.routerAddress as `0x${string}`;
      const approvalData = encodeFunctionData({
        abi: erc20Abi,
        functionName: 'approve',
        args: [router, maximumAmount],
      });
      const message = intent.typedData.message;
      const paymentData = encodeFunctionData({
        abi: paymentRouterAbi,
        functionName: 'pay',
        args: [
          {
            intentId: message.intentId as `0x${string}`,
            merchant: message.merchant as `0x${string}`,
            signer: signedSigner(intent),
            settlementToken: message.settlementToken as `0x${string}`,
            settlementAmount: BigInt(String(message.settlementAmount)),
            splitId: message.splitId as `0x${string}`,
            splitHash: message.splitHash as `0x${string}`,
            platformFee: BigInt(String(message.platformFee)),
            validAfter: Number(message.validAfter),
            expiresAt: Number(message.expiresAt),
            payer: message.payer as `0x${string}`,
            metadataHash: message.metadataHash as `0x${string}`,
          },
          intent.signature as `0x${string}`,
          {
            tokenIn: body.tokenIn,
            maxAmountIn: maximumAmount,
            adapter: currentAdapter,
            adapterData: quote.option.adapterData,
          },
        ],
      });
      return {
        quote: serializeQuoteEnvelope(intent, envelope, body.quoteId),
        approval: {
          required: true,
          token: body.tokenIn,
          spender: router,
          amount: maximumAmount.toString(),
          transaction: { to: body.tokenIn, data: approvalData, value: '0' },
        },
        payment: {
          transaction: {
            to: router,
            data: paymentData,
            value: '0',
            chainId: intent.chainId,
          },
        },
      };
    },
  );

  app.post(
    '/v1/payment-intents/:id/refunds',
    {
      preHandler: [authenticate(services, 'refunds:write'), protectMutation(services)],
      schema: {
        tags: ['Refunds'],
        summary: 'Prepare a merchant-funded on-chain refund',
        params: idParams,
        body: refundBody,
      },
    },
    async (request, reply) => {
      const principal = request.principal;
      if (!principal) throw new Error('Authentication pre-handler did not run');
      const { id } = idParams.parse(request.params);
      const body = refundBody.parse(request.body);
      const [intent] = await services.db
        .select()
        .from(paymentIntents)
        .where(and(eq(paymentIntents.id, id), eq(paymentIntents.merchantId, principal.merchantId)))
        .limit(1);
      if (!intent) {
        throw new HttpError(404, 'payment_intent_not_found', 'PaymentIntent was not found');
      }
      await assertCachedRouterConfiguration(services);
      if (intent.routerAddress !== services.config.PAYMENT_ROUTER_ADDRESS) {
        throw new HttpError(
          409,
          'payment_router_changed',
          'Refund preparation for a different PaymentRouter is not supported by this indexer',
        );
      }
      if (!['succeeded', 'partially_refunded'].includes(intent.status)) {
        throw new HttpError(
          409,
          'payment_not_refundable',
          'Only a chain-verified payment can be refunded',
        );
      }
      const [existing] = await services.db
        .select()
        .from(refundRequests)
        .where(
          and(
            eq(refundRequests.merchantId, principal.merchantId),
            eq(refundRequests.idempotencyKey, body.idempotencyKey),
          ),
        )
        .limit(1);
      if (existing) {
        if (
          existing.paymentIntentId !== intent.id ||
          existing.amount !== body.amount ||
          (existing.reason ?? null) !== (body.reason ?? null)
        ) {
          throw new HttpError(
            409,
            'idempotency_key_conflict',
            'Idempotency key was already used with different refund parameters',
          );
        }
        if (!['requested', 'submitted'].includes(existing.status)) {
          throw new HttpError(
            409,
            'refund_already_processed',
            'This idempotent refund request is no longer pending; use a new idempotency key',
          );
        }
        return buildRefundResponse(intent, existing);
      }
      const amount = BigInt(body.amount);
      const prepared = await services.db.transaction(async (tx) => {
        // Serialize refund preparation with indexer reorg projections. Once
        // calldata has been issued, a submitted identity must keep blocking
        // replacement calldata even if its formerly canonical event reorgs.
        const [lockedIntent] = await tx
          .select()
          .from(paymentIntents)
          .where(
            and(
              eq(paymentIntents.id, intent.id),
              eq(paymentIntents.merchantId, principal.merchantId),
            ),
          )
          .for('update')
          .limit(1);
        if (!lockedIntent || !['succeeded', 'partially_refunded'].includes(lockedIntent.status)) {
          throw new HttpError(
            409,
            'payment_not_refundable',
            'Only a chain-verified payment can be refunded',
          );
        }
        const pending = await tx
          .select({ id: refundRequests.id })
          .from(refundRequests)
          .where(
            and(
              eq(refundRequests.paymentIntentId, lockedIntent.id),
              inArray(refundRequests.status, ['requested', 'submitted']),
            ),
          )
          .limit(1);
        if (pending.length > 0) {
          throw new HttpError(
            409,
            'refund_pending',
            'Wait for the current refund to be chain-verified before creating another',
          );
        }
        const remaining =
          BigInt(lockedIntent.settlementAmount) - BigInt(lockedIntent.refundedAmount);
        if (amount > remaining) {
          throw new HttpError(
            422,
            'refund_amount_exceeds_remaining',
            'Refund amount exceeds the remaining refundable amount',
          );
        }
        const [createdRefund] = await tx
          .insert(refundRequests)
          .values({
            refundId: createBytes32(),
            paymentIntentId: lockedIntent.id,
            merchantId: principal.merchantId,
            idempotencyKey: body.idempotencyKey,
            amount: amount.toString(),
            ...(body.reason ? { reason: body.reason } : {}),
          })
          .onConflictDoNothing()
          .returning();
        if (createdRefund) {
          return { intent: lockedIntent, refund: createdRefund, created: true };
        }
        const [raced] = await tx
          .select()
          .from(refundRequests)
          .where(
            and(
              eq(refundRequests.merchantId, principal.merchantId),
              eq(refundRequests.idempotencyKey, body.idempotencyKey),
            ),
          )
          .limit(1);
        if (
          raced &&
          ['requested', 'submitted'].includes(raced.status) &&
          raced.paymentIntentId === lockedIntent.id &&
          raced.amount === body.amount &&
          (raced.reason ?? null) === (body.reason ?? null)
        ) {
          return { intent: lockedIntent, refund: raced, created: false };
        }
        throw new HttpError(
          409,
          raced ? 'idempotency_key_conflict' : 'refund_pending',
          raced
            ? 'Idempotency key was already used with different refund parameters'
            : 'Another refund request is already pending',
        );
      });
      reply.code(prepared.created ? 201 : 200);
      return buildRefundResponse(prepared.intent, prepared.refund);
    },
  );

  app.post(
    '/v1/payment-intents/:id/refunds/:refundId/resume',
    {
      preHandler: [authenticate(services, 'refunds:write'), protectMutation(services)],
      schema: {
        tags: ['Refunds'],
        summary: 'Rebuild transactions for the same pending refund identity',
        params: refundParams,
      },
    },
    async (request) => {
      const principal = request.principal;
      if (!principal) throw new Error('Authentication pre-handler did not run');
      const { id, refundId } = refundParams.parse(request.params);
      const [row] = await services.db
        .select({ intent: paymentIntents, refund: refundRequests })
        .from(refundRequests)
        .innerJoin(paymentIntents, eq(paymentIntents.id, refundRequests.paymentIntentId))
        .where(
          and(
            eq(paymentIntents.id, id),
            eq(paymentIntents.merchantId, principal.merchantId),
            eq(refundRequests.refundId, refundId),
          ),
        )
        .limit(1);
      if (!row) throw new HttpError(404, 'refund_not_found', 'Refund request was not found');
      if (!['requested', 'submitted'].includes(row.refund.status)) {
        throw new HttpError(
          409,
          'refund_not_resumable',
          'Only a pending refund request can be resumed',
        );
      }
      await assertCachedRouterConfiguration(services);
      return buildRefundResponse(row.intent, row.refund);
    },
  );
}

async function getPayableIntent(services: AppServices, id: string) {
  const [intent] = await services.db
    .select()
    .from(paymentIntents)
    .where(eq(paymentIntents.id, id))
    .limit(1);
  if (!intent) {
    throw new HttpError(404, 'payment_intent_not_found', 'PaymentIntent was not found');
  }
  if (intent.status !== 'created' || intent.expiresAt <= new Date()) {
    throw new HttpError(
      409,
      'payment_intent_not_payable',
      'PaymentIntent is expired or no longer payable',
    );
  }
  return intent;
}

async function getActiveIntentMerchant(
  services: AppServices,
  intent: typeof paymentIntents.$inferSelect,
) {
  const [stored] = await services.db
    .select()
    .from(merchants)
    .where(eq(merchants.id, intent.merchantId))
    .limit(1);
  if (!stored) throw new Error('PaymentIntent merchant was not found');
  const merchant = await refreshMerchantRegistration(services, stored);
  if (
    merchant.status !== 'active' ||
    merchant.delegatedSignerAddress !== intent.signerAddress ||
    signedSigner(intent) !== merchant.delegatedSignerAddress
  ) {
    throw new HttpError(
      409,
      'payment_intent_authorization_revoked',
      'Merchant or delegated signer is no longer authorized on-chain',
    );
  }
  return merchant;
}

function issueQuote(
  services: AppServices,
  intent: typeof paymentIntents.$inferSelect,
  tokenIn: `0x${string}`,
  quote: Awaited<ReturnType<typeof calculateQuote>>,
  settlementRecipients: readonly {
    address: `0x${string}`;
    basisPoints: number;
  }[],
) {
  const quotedAt = quote.quotedAt.getTime();
  const expiresAt = Math.min(intent.expiresAt.getTime(), quotedAt + 30_000);
  const envelope = {
    version: 1 as const,
    paymentIntentId: intent.id,
    paymentId: intent.paymentId as `0x${string}`,
    tokenIn,
    estimatedInputAmount: quote.estimatedAmount.toString(),
    maximumInputAmount: quote.maximumAmount.toString(),
    slippageBps: quote.slippageBps,
    adapter: quote.option.adapter ?? zeroAddress,
    adapterIdentifier: quote.option.adapterIdentifier,
    settlementRecipients: settlementRecipients.map((recipient) => ({ ...recipient })),
    quotedAt,
    expiresAt,
  };
  const quoteId = encodeSignedPayload(envelope, services.config.sessionSecrets.quoteEnvelope);
  return serializeQuoteEnvelope(intent, envelope, quoteId);
}

function serializeQuoteEnvelope(
  intent: typeof paymentIntents.$inferSelect,
  envelope: z.infer<typeof quoteEnvelopeSchema>,
  quoteId: string,
) {
  return {
    quoteId,
    tokenIn: envelope.tokenIn,
    settlementToken: intent.settlementToken,
    exactMerchantAmount: intent.settlementAmount,
    platformFee: intent.platformFee,
    estimatedInputAmount: envelope.estimatedInputAmount,
    maximumInputAmount: envelope.maximumInputAmount,
    slippageBps: envelope.slippageBps,
    adapter: envelope.adapter,
    adapterIdentifier: envelope.adapterIdentifier,
    settlementRecipients: envelope.settlementRecipients,
    router: intent.routerAddress,
    approvalSpender: intent.routerAddress,
    quotedAt: new Date(envelope.quotedAt).toISOString(),
    expiresAt: new Date(envelope.expiresAt).toISOString(),
  };
}

export function serializePublicRefund(
  refund: typeof refundRequests.$inferSelect,
  explorerBaseUrl: string | null = null,
) {
  return {
    id: refund.id,
    refundId: refund.refundId,
    status: refund.status,
    amount: refund.amount,
    transactionHash: refund.transactionHash,
    explorerUrl: refund.transactionHash
      ? explorerTransactionUrl(refund.transactionHash as `0x${string}`, explorerBaseUrl)
      : null,
    blockNumber: refund.blockNumber?.toString() ?? null,
    verifiedAt: refund.chainVerifiedAt?.toISOString() ?? null,
    createdAt: refund.createdAt.toISOString(),
    updatedAt: refund.updatedAt.toISOString(),
  };
}

function buildRefundResponse(
  intent: typeof paymentIntents.$inferSelect,
  refund: typeof refundRequests.$inferSelect,
) {
  const router = intent.routerAddress as `0x${string}`;
  const amount = BigInt(refund.amount);
  return {
    refund: {
      ...serializePublicRefund(refund),
      reason: refund.reason,
    },
    approval: {
      to: intent.settlementToken,
      data: encodeFunctionData({
        abi: erc20Abi,
        functionName: 'approve',
        args: [router, amount],
      }),
      value: '0',
    },
    transaction: {
      to: router,
      data: encodeFunctionData({
        abi: paymentRouterAbi,
        functionName: 'refund',
        args: [
          signedMerchant(intent),
          intent.paymentId as `0x${string}`,
          refund.refundId as `0x${string}`,
          amount,
        ],
      }),
      value: '0',
      chainId: intent.chainId,
    },
  };
}
