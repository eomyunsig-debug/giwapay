import { and, apiKeys, desc, eq, merchants } from '@giwapay/db';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { merchantRegistryAbi, zeroAddress } from '../abi.js';
import { authenticate, protectMutation, serializeMerchant } from '../auth.js';
import { randomToken, secretDigest } from '../crypto.js';
import { HttpError } from '../errors.js';
import { normalizeAddress } from '../chain.js';
import type { AppServices } from '../types.js';

const updateMerchantBody = z.object({
  displayName: z.string().trim().min(1).max(100),
});

const apiKeyBody = z.object({
  idempotencyKey: z.string().trim().min(8).max(255),
  name: z.string().trim().min(1).max(100),
  scopes: z
    .array(
      z.enum(['payment_intents:read', 'payment_intents:write', 'refunds:write', 'webhooks:write']),
    )
    .min(1)
    .default(['payment_intents:read', 'payment_intents:write'])
    .transform((values) => [...new Set(values)].sort()),
  expiresAt: z.iso.datetime().optional(),
});

const idParams = z.object({ id: z.uuid() });

function requireSession(principal: ExpressiblePrincipal | undefined) {
  if (principal?.authType !== 'session') {
    throw new HttpError(
      403,
      'wallet_session_required',
      'A merchant wallet session is required for this operation',
    );
  }
}

type ExpressiblePrincipal = {
  authType: 'session' | 'api_key';
};

function serializeApiKey(key: typeof apiKeys.$inferSelect) {
  return {
    id: key.id,
    name: key.name,
    prefix: key.prefix,
    scopes: key.scopes,
    expiresAt: key.expiresAt?.toISOString() ?? null,
    lastUsedAt: key.lastUsedAt?.toISOString() ?? null,
    revokedAt: key.revokedAt?.toISOString() ?? null,
    createdAt: key.createdAt.toISOString(),
  };
}

export async function registerMerchantRoutes(app: FastifyInstance, services: AppServices) {
  app.get(
    '/v1/merchants/me',
    {
      preHandler: [authenticate(services)],
      schema: { tags: ['Merchants'], summary: 'Get the current merchant' },
    },
    async (request) => {
      const principal = request.principal;
      if (!principal) throw new Error('Authentication pre-handler did not run');
      return {
        merchant: serializeMerchant(principal.merchant),
        requiredDelegatedSignerAddress: services.intentSigner.address ?? null,
      };
    },
  );

  app.patch(
    '/v1/merchants/me',
    {
      preHandler: [authenticate(services), protectMutation(services)],
      schema: {
        tags: ['Merchants'],
        summary: 'Update off-chain merchant display settings',
        body: updateMerchantBody,
      },
    },
    async (request) => {
      requireSession(request.principal);
      const body = updateMerchantBody.parse(request.body);
      const principal = request.principal;
      if (!principal) throw new Error('Authentication pre-handler did not run');
      const [merchant] = await services.db
        .update(merchants)
        .set({
          settings: {
            ...principal.merchant.settings,
            displayName: body.displayName,
          },
          updatedAt: new Date(),
        })
        .where(eq(merchants.id, principal.merchantId))
        .returning();
      if (!merchant) throw new Error('Merchant update did not return a row');
      return { merchant: serializeMerchant(merchant) };
    },
  );

  app.post(
    '/v1/merchants/me/registration/verify',
    {
      preHandler: [authenticate(services), protectMutation(services)],
      schema: {
        tags: ['Merchants'],
        summary: 'Read MerchantRegistry and synchronize independently verified registration',
      },
    },
    async (request) => {
      requireSession(request.principal);
      const principal = request.principal;
      if (!principal) throw new Error('Authentication pre-handler did not run');
      const merchant = await refreshMerchantRegistration(services, principal.merchant);
      return { merchant: serializeMerchant(merchant) };
    },
  );

  app.get(
    '/v1/api-keys',
    {
      preHandler: [authenticate(services)],
      schema: { tags: ['API keys'], summary: 'List merchant API keys' },
    },
    async (request) => {
      requireSession(request.principal);
      const principal = request.principal;
      if (!principal) throw new Error('Authentication pre-handler did not run');
      const rows = await services.db
        .select()
        .from(apiKeys)
        .where(eq(apiKeys.merchantId, principal.merchantId))
        .orderBy(desc(apiKeys.createdAt));
      return { data: rows.map(serializeApiKey) };
    },
  );

  app.post(
    '/v1/api-keys',
    {
      preHandler: [authenticate(services), protectMutation(services)],
      schema: {
        tags: ['API keys'],
        summary: 'Create an API key; the secret is returned exactly once',
        body: apiKeyBody,
      },
    },
    async (request, reply) => {
      requireSession(request.principal);
      const principal = request.principal;
      if (!principal) throw new Error('Authentication pre-handler did not run');
      const verifiedMerchant = await refreshMerchantRegistration(services, principal.merchant);
      if (verifiedMerchant.status !== 'active') {
        throw new HttpError(
          409,
          'merchant_not_registered',
          'Complete and verify on-chain merchant registration first',
        );
      }
      const body = apiKeyBody.parse(request.body);
      const headerKey = request.headers['idempotency-key'];
      if (typeof headerKey === 'string' && headerKey !== body.idempotencyKey) {
        throw new HttpError(
          400,
          'idempotency_key_mismatch',
          'Body and header idempotency keys do not match',
        );
      }
      const [existing] = await services.db
        .select()
        .from(apiKeys)
        .where(
          and(
            eq(apiKeys.merchantId, principal.merchantId),
            eq(apiKeys.idempotencyKey, body.idempotencyKey),
          ),
        )
        .limit(1);
      if (existing) {
        const requestedExpiry = body.expiresAt ? new Date(body.expiresAt).getTime() : null;
        const existingExpiry = existing.expiresAt?.getTime() ?? null;
        if (
          existing.name !== body.name ||
          JSON.stringify(existing.scopes) !== JSON.stringify(body.scopes) ||
          existingExpiry !== requestedExpiry
        ) {
          throw new HttpError(
            409,
            'idempotency_key_conflict',
            'Idempotency key was already used with different API key parameters',
          );
        }
        throw new HttpError(
          409,
          'api_key_secret_already_issued',
          'This API key secret was already issued and cannot be replayed; use a new idempotency key',
        );
      }
      const rawKey = `gwp_test_${randomToken(32)}`;
      const [key] = await services.db
        .insert(apiKeys)
        .values({
          merchantId: principal.merchantId,
          idempotencyKey: body.idempotencyKey,
          name: body.name,
          prefix: rawKey.slice(0, 20),
          keyHash: secretDigest(rawKey, services.config.API_KEY_PEPPER),
          scopes: body.scopes,
          ...(body.expiresAt ? { expiresAt: new Date(body.expiresAt) } : {}),
        })
        .onConflictDoNothing()
        .returning();
      if (!key) {
        throw new HttpError(
          409,
          'api_key_secret_already_issued',
          'This API key secret was already issued and cannot be replayed; use a new idempotency key',
        );
      }
      reply.code(201);
      return { apiKey: serializeApiKey(key), secret: rawKey };
    },
  );

  app.delete(
    '/v1/api-keys/:id',
    {
      preHandler: [authenticate(services), protectMutation(services)],
      schema: {
        tags: ['API keys'],
        summary: 'Revoke an API key',
        params: idParams,
      },
    },
    async (request, reply) => {
      requireSession(request.principal);
      const principal = request.principal;
      if (!principal) throw new Error('Authentication pre-handler did not run');
      const params = idParams.parse(request.params);
      const revoked = await services.db
        .update(apiKeys)
        .set({ revokedAt: new Date() })
        .where(and(eq(apiKeys.id, params.id), eq(apiKeys.merchantId, principal.merchantId)))
        .returning({ id: apiKeys.id, merchantId: apiKeys.merchantId });
      const key = revoked[0];
      if (!key) {
        throw new HttpError(404, 'api_key_not_found', 'API key was not found');
      }
      reply.code(204).send();
    },
  );
}

export async function refreshMerchantRegistration(
  services: AppServices,
  merchant: typeof merchants.$inferSelect,
) {
  const registryAddress = services.config.MERCHANT_REGISTRY_ADDRESS;
  if (!registryAddress) {
    throw new HttpError(503, 'merchant_registry_unavailable', 'MerchantRegistry is not configured');
  }
  let config: {
    admin: `0x${string}`;
    payoutAddress: `0x${string}`;
    delegatedSigner: `0x${string}`;
    refundOperator: `0x${string}`;
    active: boolean;
    createdAt: bigint;
    updatedAt: bigint;
  };
  try {
    const head = await services.chainClient.getBlockNumber();
    const confirmations = BigInt(services.config.CHAIN_CONFIRMATIONS);
    if (head < confirmations) {
      throw new Error('Chain has insufficient confirmed blocks');
    }
    config = await services.chainClient.readContract({
      address: registryAddress,
      abi: merchantRegistryAbi,
      functionName: 'getMerchant',
      args: [merchant.adminAddress as `0x${string}`],
      blockNumber: head - confirmations,
    });
  } catch {
    throw new HttpError(
      503,
      'merchant_registry_read_failed',
      'MerchantRegistry could not be verified',
    );
  }
  if (normalizeAddress(config.admin) !== merchant.adminAddress || config.createdAt === 0n) {
    throw new HttpError(
      409,
      'merchant_not_registered',
      'The wallet is not registered in MerchantRegistry',
    );
  }
  const [updated] = await services.db
    .update(merchants)
    .set({
      payoutAddress: normalizeAddress(config.payoutAddress),
      delegatedSignerAddress:
        config.delegatedSigner === zeroAddress ? null : normalizeAddress(config.delegatedSigner),
      refundOperatorAddress:
        config.refundOperator === zeroAddress ? null : normalizeAddress(config.refundOperator),
      status: config.active ? 'active' : 'paused',
      onchainRegisteredAt: new Date(Number(config.createdAt) * 1_000),
      updatedAt: new Date(),
    })
    .where(eq(merchants.id, merchant.id))
    .returning();
  if (!updated) throw new Error('Merchant synchronization returned no row');
  return updated;
}
