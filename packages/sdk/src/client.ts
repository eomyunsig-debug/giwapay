import { z, type ZodType } from 'zod';
import type { Address, Hex } from 'viem';

import {
  apiKeySummarySchema,
  authNonceSchema,
  authSessionSchema,
  createPaymentIntentInputSchema,
  createPaymentIntentResponseSchema,
  createdApiKeySchema,
  merchantResponseSchema,
  merchantRefundListSchema,
  merchantSchema,
  merchantUpdateSchema,
  paymentIntentDetailSchema,
  paymentIntentListSchema,
  paymentMethodListSchema,
  preparePaymentInputSchema,
  preparePaymentResponseSchema,
  quoteSchema,
  refundPreparationSchema,
  refundRequestSchema,
  type ApiKeySummary,
  type AuthNonce,
  type AuthSession,
  type CreatePaymentIntentInput,
  type CreatePaymentIntentResponse,
  type CreatedApiKey,
  type Merchant,
  type MerchantResponse,
  type MerchantRefundList,
  type MerchantUpdate,
  type PaymentIntentDetail,
  type PaymentIntentList,
  type PaymentMethodList,
  type PaymentQuote,
  type PreparePaymentInput,
  type PreparePaymentResponse,
  type RefundPreparation,
  type RefundRequest,
} from './schemas.js';

type FetchImplementation = typeof fetch;

export interface GiwaPayClientOptions {
  baseUrl: string;
  apiKey?: string;
  fetch?: FetchImplementation;
  credentials?: RequestCredentials;
  timeoutMs?: number;
  getCsrfToken?: () => string | undefined | Promise<string | undefined>;
}

export class GiwaPayApiError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly details?: unknown;

  constructor(message: string, options: { status: number; code?: string; details?: unknown }) {
    super(message);
    this.name = 'GiwaPayApiError';
    this.status = options.status;
    if (options.code !== undefined) this.code = options.code;
    if (options.details !== undefined) this.details = options.details;
  }
}

const apiErrorSchema = z.object({
  error: z
    .object({
      code: z.string().optional(),
      message: z.string().optional(),
      details: z.unknown().optional(),
    })
    .optional(),
  message: z.string().optional(),
});

const sleep = async (milliseconds: number): Promise<void> => {
  await new Promise((resolve) => globalThis.setTimeout(resolve, milliseconds));
};

export class GiwaPayClient {
  readonly baseUrl: string;
  private readonly apiKey?: string;
  private readonly fetchImplementation: FetchImplementation;
  private readonly credentials: RequestCredentials;
  private readonly timeoutMs: number;
  private readonly getCsrfToken?: GiwaPayClientOptions['getCsrfToken'];

  constructor(options: GiwaPayClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, '');
    if (options.apiKey !== undefined) this.apiKey = options.apiKey;
    this.fetchImplementation = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.credentials = options.credentials ?? 'include';
    this.timeoutMs = options.timeoutMs ?? 12_000;
    if (options.getCsrfToken !== undefined) {
      this.getCsrfToken = options.getCsrfToken;
    }
  }

  async createAuthNonce(address: Address): Promise<AuthNonce> {
    return this.request('/v1/auth/nonce', {
      method: 'POST',
      body: { address },
      schema: authNonceSchema,
    });
  }

  async verifySiwe(input: { message: string; signature: Hex }): Promise<AuthSession> {
    return this.request('/v1/auth/verify', {
      method: 'POST',
      body: input,
      schema: authSessionSchema,
    });
  }

  async signOut(): Promise<void> {
    await this.request('/v1/auth/logout', {
      method: 'POST',
      schema: z.unknown(),
    });
  }

  async getMerchantContext(): Promise<MerchantResponse> {
    return this.request('/v1/merchants/me', {
      method: 'GET',
      schema: merchantResponseSchema,
    });
  }

  async getMerchant(): Promise<Merchant> {
    return (await this.getMerchantContext()).merchant;
  }

  async updateMerchant(input: MerchantUpdate): Promise<Merchant> {
    const response = await this.request('/v1/merchants/me', {
      method: 'PATCH',
      body: merchantUpdateSchema.parse(input),
      schema: z.object({ merchant: merchantSchema }),
    });
    return response.merchant;
  }

  async verifyMerchantRegistration(): Promise<Merchant> {
    const response = await this.request('/v1/merchants/me/registration/verify', {
      method: 'POST',
      schema: z.object({ merchant: merchantSchema }),
    });
    return response.merchant;
  }

  async listApiKeys(): Promise<ApiKeySummary[]> {
    const result = await this.request('/v1/api-keys', {
      method: 'GET',
      schema: z.object({ data: z.array(apiKeySummarySchema) }),
    });
    return result.data;
  }

  async createApiKey(
    name: string,
    scopes: string[] = ['payment_intents:read', 'payment_intents:write'],
  ): Promise<CreatedApiKey> {
    const idempotencyKey = globalThis.crypto.randomUUID();
    const result = await this.request('/v1/api-keys', {
      method: 'POST',
      body: {
        name: z.string().trim().min(1).max(100).parse(name),
        scopes,
        idempotencyKey,
      },
      headers: { 'Idempotency-Key': idempotencyKey },
      schema: createdApiKeySchema,
    });
    return { ...result.apiKey, key: result.secret };
  }

  async revokeApiKey(id: string): Promise<void> {
    await this.request(`/v1/api-keys/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      schema: z.unknown(),
    });
  }

  async createPaymentIntent(input: CreatePaymentIntentInput): Promise<CreatePaymentIntentResponse> {
    const body = createPaymentIntentInputSchema.parse(input);
    return this.request('/v1/payment-intents', {
      method: 'POST',
      body,
      headers: { 'Idempotency-Key': body.idempotencyKey },
      schema: createPaymentIntentResponseSchema,
    });
  }

  async listPaymentIntents(offset = 0, limit = 25): Promise<PaymentIntentList> {
    const search = new URLSearchParams({
      limit: String(limit),
      offset: String(offset),
    });
    return this.request(`/v1/payment-intents?${search.toString()}`, {
      method: 'GET',
      schema: paymentIntentListSchema,
    });
  }

  async getPaymentIntent(id: string): Promise<PaymentIntentDetail> {
    return this.request(`/v1/payment-intents/${encodeURIComponent(id)}`, {
      method: 'GET',
      schema: paymentIntentDetailSchema,
    });
  }

  async listMerchantRefunds(id: string): Promise<MerchantRefundList> {
    return this.request(`/v1/payment-intents/${encodeURIComponent(id)}/refunds`, {
      method: 'GET',
      schema: merchantRefundListSchema,
    });
  }

  async listPaymentMethods(settlementToken?: Address): Promise<PaymentMethodList> {
    const search = new URLSearchParams();
    if (settlementToken) search.set('settlementToken', settlementToken);
    const query = search.size > 0 ? `?${search.toString()}` : '';
    return this.request(`/v1/payment-methods${query}`, {
      method: 'GET',
      schema: paymentMethodListSchema,
    });
  }

  async quotePayment(id: string, tokenIn: Address, slippageBps?: number): Promise<PaymentQuote> {
    const search = new URLSearchParams({ tokenIn });
    if (slippageBps !== undefined) {
      search.set('slippageBps', String(slippageBps));
    }
    return this.request(
      `/v1/payment-intents/${encodeURIComponent(id)}/quote?${search.toString()}`,
      { method: 'GET', schema: quoteSchema },
    );
  }

  async preparePayment(id: string, input: PreparePaymentInput): Promise<PreparePaymentResponse> {
    return this.request(`/v1/payment-intents/${encodeURIComponent(id)}/prepare`, {
      method: 'POST',
      body: preparePaymentInputSchema.parse(input),
      schema: preparePaymentResponseSchema,
    });
  }

  async requestRefund(paymentIntentId: string, input: RefundRequest): Promise<RefundPreparation> {
    const body = refundRequestSchema.parse(input);
    return this.request(`/v1/payment-intents/${encodeURIComponent(paymentIntentId)}/refunds`, {
      method: 'POST',
      body,
      headers: { 'Idempotency-Key': body.idempotencyKey },
      schema: refundPreparationSchema,
    });
  }

  async resumeRefund(paymentIntentId: string, refundId: Hex): Promise<RefundPreparation> {
    return this.request(
      `/v1/payment-intents/${encodeURIComponent(paymentIntentId)}/refunds/${encodeURIComponent(refundId)}/resume`,
      {
        method: 'POST',
        schema: refundPreparationSchema,
      },
    );
  }

  private async request<T>(
    path: string,
    options: {
      method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
      body?: unknown;
      headers?: Record<string, string>;
      schema: ZodType<T>;
    },
  ): Promise<T> {
    const attempts = options.method === 'GET' ? 3 : 1;
    let lastError: unknown;

    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const controller = new AbortController();
      const timeout = globalThis.setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        const csrfToken = await this.getCsrfToken?.();
        const headers = new Headers({
          Accept: 'application/json',
          ...options.headers,
        });
        if (options.body !== undefined) headers.set('Content-Type', 'application/json');
        if (this.apiKey) headers.set('Authorization', `Bearer ${this.apiKey}`);
        if (csrfToken && options.method !== 'GET') {
          headers.set('X-CSRF-Token', csrfToken);
        }

        const response = await this.fetchImplementation(`${this.baseUrl}${path}`, {
          method: options.method,
          credentials: this.credentials,
          headers,
          signal: controller.signal,
          ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
        });
        const text = await response.text();
        const payload: unknown = text ? JSON.parse(text) : null;
        if (!response.ok) {
          const parsedError = apiErrorSchema.safeParse(payload);
          const error = parsedError.success ? parsedError.data : {};
          throw new GiwaPayApiError(
            error.error?.message ??
              error.message ??
              `GiwaPay API request failed (${response.status})`,
            {
              status: response.status,
              ...(error.error?.code ? { code: error.error.code } : {}),
              ...(error.error?.details === undefined ? {} : { details: error.error.details }),
            },
          );
        }
        return options.schema.parse(payload);
      } catch (error) {
        lastError = error;
        const retryable =
          options.method === 'GET' &&
          attempt < attempts - 1 &&
          (!(error instanceof GiwaPayApiError) || error.status >= 500);
        if (!retryable) throw error;
        await sleep(200 * 2 ** attempt);
      } finally {
        globalThis.clearTimeout(timeout);
      }
    }
    throw lastError;
  }
}
