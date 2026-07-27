import { z } from 'zod';
import type { Address, Hex } from 'viem';

const addressSchema = z
  .string()
  .regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid EVM address')
  .transform((value) => value as Address);
const hexSchema = z
  .string()
  .regex(/^0x(?:[a-fA-F0-9]{2})*$/, 'Invalid hex value')
  .transform((value) => value as Hex);
const bytes32Schema = z
  .string()
  .regex(/^0x[a-fA-F0-9]{64}$/, 'Invalid bytes32 value')
  .transform((value) => value as Hex);
const maximumUint256 = (1n << 256n) - 1n;
const withinUint256 = (value: string) => BigInt(value) <= maximumUint256;
const uintStringSchema = z
  .string()
  .regex(/^(?:0|[1-9]\d*)$/, 'Expected an unsigned base-10 integer')
  .refine(withinUint256, 'Value exceeds uint256');
const positiveUintStringSchema = z
  .string()
  .regex(/^[1-9]\d*$/, 'Expected a positive base-10 integer')
  .refine(withinUint256, 'Value exceeds uint256');
const isoDateSchema = z.iso.datetime({ offset: true });

export const paymentStatusSchema = z.enum([
  'created',
  'submitted',
  'succeeded',
  'partially_refunded',
  'refunded',
  'expired',
]);
export type PaymentStatus = z.infer<typeof paymentStatusSchema>;

export const merchantSummarySchema = z.object({
  name: z.string().min(1).max(120),
  payoutAddress: addressSchema,
});
export type MerchantSummary = z.infer<typeof merchantSummarySchema>;

export const merchantSchema = z.object({
  id: z.uuid(),
  adminAddress: addressSchema,
  payoutAddress: addressSchema,
  delegatedSignerAddress: addressSchema.nullable(),
  refundOperatorAddress: addressSchema.nullable(),
  status: z.enum(['pending_registration', 'active', 'paused']),
  onchainRegisteredAt: isoDateSchema.nullable(),
  displayName: z.string().min(1).max(120),
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema,
});
export type Merchant = z.infer<typeof merchantSchema>;

export const paymentRecordSchema = z.object({
  payer: addressSchema.nullable(),
  inputToken: addressSchema.nullable(),
  inputAmount: uintStringSchema.nullable(),
  platformFee: uintStringSchema.nullable(),
  transactionHash: hexSchema,
  explorerUrl: z.url().nullable(),
  blockNumber: uintStringSchema.nullable(),
  blockHash: hexSchema.nullable(),
  logIndex: z.number().int().nonnegative().nullable(),
  verifiedAt: isoDateSchema.nullable(),
});
export type PaymentRecord = z.infer<typeof paymentRecordSchema>;

export const paymentIntentSchema = z.object({
  id: z.uuid(),
  paymentId: bytes32Schema,
  status: paymentStatusSchema,
  merchant: merchantSummarySchema.optional(),
  description: z.string().min(1).max(500),
  settlement: z.object({
    token: addressSchema,
    amount: positiveUintStringSchema,
  }),
  settlementRecipients: z
    .array(
      z.object({
        address: addressSchema,
        basisPoints: z.number().int().positive().max(10_000),
        amount: uintStringSchema.optional(),
      }),
    )
    .min(1)
    .max(8),
  splitId: bytes32Schema,
  splitHash: bytes32Schema,
  platformFee: uintStringSchema,
  validAfter: isoDateSchema,
  expiresAt: isoDateSchema,
  payerRestriction: addressSchema,
  chainId: z.number().int().positive(),
  routerAddress: addressSchema,
  signerAddress: addressSchema,
  signature: hexSchema,
  typedData: z.unknown(),
  payment: paymentRecordSchema.nullable(),
  refundedAmount: uintStringSchema,
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema,
});
export type PaymentIntent = z.infer<typeof paymentIntentSchema>;

export const createPaymentIntentInputSchema = z.object({
  idempotencyKey: z.string().trim().min(8).max(255),
  description: z.string().trim().min(1).max(500),
  settlementToken: addressSchema,
  settlementAmount: positiveUintStringSchema,
  splitId: bytes32Schema.optional(),
  validAfter: isoDateSchema.optional(),
  expiresAt: isoDateSchema,
  payer: addressSchema.optional(),
  metadata: z.record(z.string().max(64), z.string().max(500)).optional(),
});
export type CreatePaymentIntentInput = z.input<typeof createPaymentIntentInputSchema>;

export const createPaymentIntentResponseSchema = z.object({
  paymentIntent: paymentIntentSchema,
  checkoutUrl: z.url(),
  qrCodeDataUrl: z.string().startsWith('data:image/'),
  idempotentReplay: z.boolean(),
});
export type CreatePaymentIntentResponse = z.infer<typeof createPaymentIntentResponseSchema>;

export const paymentIntentListSchema = z.object({
  data: z.array(paymentIntentSchema),
  pagination: z.object({
    limit: z.number().int().positive(),
    offset: z.number().int().nonnegative(),
    hasMore: z.boolean(),
  }),
});
export type PaymentIntentList = z.infer<typeof paymentIntentListSchema>;

export const refundSchema = z.object({
  id: z.uuid(),
  refundId: bytes32Schema,
  status: z.enum(['requested', 'submitted', 'succeeded']),
  amount: positiveUintStringSchema,
  transactionHash: hexSchema.nullable(),
  explorerUrl: z.url().nullable(),
  blockNumber: uintStringSchema.nullable(),
  verifiedAt: isoDateSchema.nullable(),
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema,
});
export type Refund = z.infer<typeof refundSchema>;

export const merchantRefundSchema = refundSchema.extend({
  reason: z.string().max(500).nullable(),
});
export type MerchantRefund = z.infer<typeof merchantRefundSchema>;

export const merchantRefundListSchema = z.object({
  data: z.array(merchantRefundSchema),
});
export type MerchantRefundList = z.infer<typeof merchantRefundListSchema>;

export const paymentIntentDetailSchema = z.object({
  paymentIntent: paymentIntentSchema,
  refunds: z.array(refundSchema),
});
export type PaymentIntentDetail = z.infer<typeof paymentIntentDetailSchema>;

export const quoteSchema = z.object({
  quoteId: z.string().min(32).max(4_096),
  tokenIn: addressSchema,
  settlementToken: addressSchema,
  exactMerchantAmount: positiveUintStringSchema,
  platformFee: uintStringSchema,
  estimatedInputAmount: positiveUintStringSchema,
  maximumInputAmount: positiveUintStringSchema,
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
  router: addressSchema,
  approvalSpender: addressSchema,
  quotedAt: isoDateSchema,
  expiresAt: isoDateSchema,
});
export type PaymentQuote = z.infer<typeof quoteSchema>;

export const transactionRequestSchema = z.object({
  to: addressSchema,
  data: hexSchema,
  value: uintStringSchema,
  chainId: z.number().int().positive(),
});
export type TransactionRequest = z.infer<typeof transactionRequestSchema>;

export const preparePaymentInputSchema = z.object({
  tokenIn: addressSchema,
  quoteId: z.string().min(32).max(4_096),
  slippageBps: z.number().int().min(0).max(5_000).optional(),
});
export type PreparePaymentInput = z.input<typeof preparePaymentInputSchema>;

export const preparePaymentResponseSchema = z.object({
  quote: quoteSchema,
  approval: z.object({
    required: z.boolean(),
    token: addressSchema,
    spender: addressSchema,
    amount: positiveUintStringSchema,
    transaction: z.object({
      to: addressSchema,
      data: hexSchema,
      value: uintStringSchema,
    }),
  }),
  payment: z.object({
    transaction: transactionRequestSchema,
  }),
});
export type PreparePaymentResponse = z.infer<typeof preparePaymentResponseSchema>;

export const paymentMethodTokenSchema = z.object({
  address: addressSchema,
  symbol: z.string().trim().min(1).max(20),
  name: z.string().trim().min(1).max(80),
  decimals: z.number().int().min(0).max(36),
  testOnly: z.boolean(),
});
export type PaymentMethodToken = z.infer<typeof paymentMethodTokenSchema>;

export const paymentMethodSchema = z.object({
  token: paymentMethodTokenSchema,
  settlementToken: paymentMethodTokenSchema,
  route: z.object({
    adapter: addressSchema.nullable(),
    adapterIdentifier: z.string().min(1).max(80),
    defaultSlippageBps: z.number().int().min(0).max(5_000),
    maxInputCap: positiveUintStringSchema.nullable(),
  }),
});
export type PaymentMethod = z.infer<typeof paymentMethodSchema>;

export const paymentMethodListSchema = z.object({
  data: z.array(paymentMethodSchema),
});
export type PaymentMethodList = z.infer<typeof paymentMethodListSchema>;

export const apiKeySummarySchema = z.object({
  id: z.uuid(),
  name: z.string(),
  prefix: z.string(),
  scopes: z.array(z.string()),
  expiresAt: isoDateSchema.nullable(),
  lastUsedAt: isoDateSchema.nullable(),
  revokedAt: isoDateSchema.nullable(),
  createdAt: isoDateSchema,
});
export type ApiKeySummary = z.infer<typeof apiKeySummarySchema>;

export const createdApiKeySchema = z.object({
  apiKey: apiKeySummarySchema,
  secret: z.string().min(20),
});
export type CreatedApiKeyResponse = z.infer<typeof createdApiKeySchema>;

export interface CreatedApiKey extends ApiKeySummary {
  key: string;
}

export const authNonceSchema = z.object({
  nonce: z.string().min(8),
  domain: z.string().min(1),
  uri: z.url(),
  chainId: z.number().int().positive(),
  issuedAt: isoDateSchema,
  expirationTime: isoDateSchema,
  statement: z.string().min(1),
});
export type AuthNonce = z.infer<typeof authNonceSchema>;

export const authSessionSchema = z.object({
  merchant: merchantSchema,
  csrfToken: z.string().min(16),
});
export type AuthSession = z.infer<typeof authSessionSchema>;

export const merchantResponseSchema = z.object({
  merchant: merchantSchema,
  requiredDelegatedSignerAddress: addressSchema.nullable(),
});
export type MerchantResponse = z.infer<typeof merchantResponseSchema>;

export const merchantUpdateSchema = z.object({
  displayName: z.string().trim().min(1).max(100),
});
export type MerchantUpdate = z.input<typeof merchantUpdateSchema>;

export const refundRequestSchema = z.object({
  amount: positiveUintStringSchema,
  reason: z.string().trim().max(500).optional(),
  idempotencyKey: z.string().trim().min(8).max(255),
});
export type RefundRequest = z.input<typeof refundRequestSchema>;

export const refundPreparationSchema = z.object({
  refund: refundSchema,
  approval: z.object({
    to: addressSchema,
    data: hexSchema,
    value: uintStringSchema,
  }),
  transaction: transactionRequestSchema,
});
export type RefundPreparation = z.infer<typeof refundPreparationSchema>;

export {
  addressSchema,
  bytes32Schema,
  hexSchema,
  isoDateSchema,
  positiveUintStringSchema,
  uintStringSchema,
};
