import {
  and,
  apiKeys,
  authNonces,
  eq,
  gt,
  isNull,
  lt,
  merchants,
  ne,
  or,
  sessions,
} from '@giwapay/db';
import type { FastifyInstance, FastifyRequest, preHandlerHookHandler } from 'fastify';
import { SiweMessage } from 'siwe';
import { getAddress, type Address } from 'viem';
import { z } from 'zod';

import { randomSiweNonce, randomToken, safeSecretEqual, secretDigest } from './crypto.js';
import { merchantRegistryAbi, zeroAddress } from './abi.js';
import { AsyncTtlCache } from './cache.js';
import { normalizeAddress } from './chain.js';
import { HttpError } from './errors.js';
import { requireAllowedOrigin } from './http-security.js';
import type { AppServices, AuthPrincipal } from './types.js';

const addressSchema = z
  .string()
  .regex(/^0x[0-9a-fA-F]{40}$/)
  .transform((value) => value.toLowerCase());

const nonceBody = z.object({ address: addressSchema });
const verifyBody = z.object({
  message: z.string().min(1).max(8_000),
  signature: z.string().regex(/^0x[0-9a-fA-F]+$/),
});

const sessionCookie = 'giwapay_session';
const csrfCookie = 'giwapay_csrf';
const siweStatement = 'Sign in to GiwaPay. This does not submit a transaction.';
const adminIdentityCaches = new WeakMap<
  object,
  AsyncTtlCache<{ merchantAddress: Address; registered: boolean }>
>();

function sessionCookieOptions(services: AppServices, httpOnly: boolean) {
  return {
    path: '/',
    httpOnly,
    secure: services.config.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    maxAge: services.config.SESSION_TTL_SECONDS,
    ...(services.config.SESSION_COOKIE_DOMAIN
      ? { domain: services.config.SESSION_COOKIE_DOMAIN }
      : {}),
  };
}

async function loadAdminMerchantIdentity(
  services: AppServices,
  adminAddress: Address,
): Promise<{ merchantAddress: Address; registered: boolean }> {
  const registry = services.config.MERCHANT_REGISTRY_ADDRESS;
  if (!registry) {
    return { merchantAddress: normalizeAddress(adminAddress), registered: false };
  }
  try {
    const head = await services.chainClient.getBlockNumber();
    const confirmations = BigInt(services.config.CHAIN_CONFIRMATIONS);
    if (head < confirmations) throw new Error('Insufficient confirmed blocks');
    const blockNumber = head - confirmations;
    const merchantAddress = normalizeAddress(
      await services.chainClient.readContract({
        address: registry,
        abi: merchantRegistryAbi,
        functionName: 'merchantForAdmin',
        args: [adminAddress],
        blockNumber,
      }),
    );
    if (merchantAddress !== zeroAddress) {
      return { merchantAddress, registered: true };
    }
    const record = await services.chainClient.readContract({
      address: registry,
      abi: merchantRegistryAbi,
      functionName: 'getMerchant',
      args: [adminAddress],
      blockNumber,
    });
    if (record.admin !== zeroAddress && normalizeAddress(record.admin) !== adminAddress) {
      throw new HttpError(
        403,
        'merchant_admin_rotated',
        'This wallet no longer administers the registered merchant',
      );
    }
    return {
      merchantAddress: normalizeAddress(adminAddress),
      registered: record.admin !== zeroAddress,
    };
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(
      503,
      'merchant_identity_unavailable',
      'Current merchant admin authority could not be verified on-chain',
      { cause: error },
    );
  }
}

async function readAdminMerchantIdentity(
  services: AppServices,
  adminAddress: Address,
  fresh = false,
) {
  if (fresh) return loadAdminMerchantIdentity(services, adminAddress);
  let cache = adminIdentityCaches.get(services.chainClient);
  if (!cache) {
    cache = new AsyncTtlCache(1_000);
    adminIdentityCaches.set(services.chainClient, cache);
  }
  return cache.get(adminAddress, services.config.CHAIN_READ_CACHE_TTL_MS, () =>
    loadAdminMerchantIdentity(services, adminAddress),
  );
}

async function assertCurrentSessionAdmin(
  services: AppServices,
  merchant: typeof merchants.$inferSelect,
  walletAddress: string,
) {
  if (walletAddress !== merchant.adminAddress) return false;
  const identity = await readAdminMerchantIdentity(services, walletAddress as Address);
  return !identity.registered || identity.merchantAddress === merchant.onchainMerchantAddress;
}

export async function resolvePrincipal(
  request: FastifyRequest,
  services: AppServices,
): Promise<AuthPrincipal | undefined> {
  const authorization = request.headers.authorization;
  if (authorization?.startsWith('Bearer ')) {
    const presented = authorization.slice('Bearer '.length);
    if (!presented.startsWith('gwp_test_') || presented.length < 30) {
      return undefined;
    }
    const keyHash = secretDigest(presented, services.config.API_KEY_PEPPER);
    const [key] = await services.db
      .select()
      .from(apiKeys)
      .where(
        and(
          eq(apiKeys.keyHash, keyHash),
          isNull(apiKeys.revokedAt),
          // An absent expiry is represented by the first branch below.
        ),
      )
      .limit(1);
    if (!key || (key.expiresAt && key.expiresAt <= new Date())) {
      return undefined;
    }
    const [merchant] = await services.db
      .select()
      .from(merchants)
      .where(eq(merchants.id, key.merchantId))
      .limit(1);
    if (!merchant) return undefined;
    const lastUsedWriteCutoff = new Date(
      Date.now() - services.config.API_KEY_LAST_USED_WRITE_INTERVAL_MS,
    );
    await services.db
      .update(apiKeys)
      .set({ lastUsedAt: new Date() })
      .where(
        and(
          eq(apiKeys.id, key.id),
          or(isNull(apiKeys.lastUsedAt), lt(apiKeys.lastUsedAt, lastUsedWriteCutoff)),
        ),
      );
    return {
      merchantId: merchant.id,
      merchant,
      authType: 'api_key',
      apiKeyId: key.id,
      scopes: key.scopes,
    };
  }

  const token = request.cookies[sessionCookie];
  if (!token) return undefined;
  const tokenHash = secretDigest(token, services.config.sessionSecrets.sessionToken);
  const [session] = await services.db
    .select()
    .from(sessions)
    .where(
      and(
        eq(sessions.tokenHash, tokenHash),
        isNull(sessions.revokedAt),
        gt(sessions.expiresAt, new Date()),
      ),
    )
    .limit(1);
  if (!session) return undefined;
  const [merchant] = await services.db
    .select()
    .from(merchants)
    .where(eq(merchants.id, session.merchantId))
    .limit(1);
  if (!merchant) return undefined;
  if (!(await assertCurrentSessionAdmin(services, merchant, session.walletAddress))) {
    await services.db
      .update(sessions)
      .set({ revokedAt: new Date() })
      .where(eq(sessions.id, session.id));
    return undefined;
  }
  return {
    merchantId: merchant.id,
    merchant,
    authType: 'session',
    sessionId: session.id,
    scopes: ['payment_intents:read', 'payment_intents:write', 'refunds:write', 'webhooks:write'],
  };
}

export function authenticate(services: AppServices, scope?: string): preHandlerHookHandler {
  return async (request) => {
    const principal = await resolvePrincipal(request, services);
    if (!principal) {
      throw new HttpError(401, 'authentication_required', 'Sign in is required');
    }
    if (scope && !principal.scopes.includes(scope)) {
      throw new HttpError(403, 'scope_required', `Missing scope: ${scope}`);
    }
    request.principal = principal;
  };
}

export function protectMutation(services: AppServices): preHandlerHookHandler {
  return async (request) => {
    const principal = request.principal;
    if (!principal) {
      throw new HttpError(401, 'authentication_required', 'Sign in is required');
    }
    if (principal.authType === 'api_key') return;
    requireAllowedOrigin(request.headers.origin, services.config);
    const csrf = request.headers['x-csrf-token'];
    if (typeof csrf !== 'string' || !principal.sessionId) {
      throw new HttpError(403, 'csrf_invalid', 'CSRF token is missing');
    }
    const [session] = await services.db
      .select({ csrfHash: sessions.csrfHash })
      .from(sessions)
      .where(eq(sessions.id, principal.sessionId))
      .limit(1);
    if (!session || !safeSecretEqual(csrf, session.csrfHash, services.config.sessionSecrets.csrf)) {
      throw new HttpError(403, 'csrf_invalid', 'CSRF token is invalid');
    }
  };
}

export async function registerAuthRoutes(app: FastifyInstance, services: AppServices) {
  app.post(
    '/v1/auth/nonce',
    {
      schema: {
        tags: ['Authentication'],
        summary: 'Create a short-lived, single-use SIWE nonce',
        body: nonceBody,
      },
      config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
    },
    async (request) => {
      const body = nonceBody.parse(request.body);
      const origin = requireAllowedOrigin(request.headers.origin, services.config);
      const parsedOrigin = new URL(origin);
      const nonce = randomSiweNonce();
      const issuedAt = new Date();
      const expiresAt = new Date(
        issuedAt.getTime() + services.config.SIWE_NONCE_TTL_SECONDS * 1_000,
      );
      await services.db.insert(authNonces).values({
        nonceHash: secretDigest(nonce, services.config.sessionSecrets.siweNonce),
        walletAddress: body.address,
        domain: parsedOrigin.host,
        uri: parsedOrigin.origin,
        chainId: services.config.GIWA_CHAIN_ID,
        expiresAt,
        createdAt: issuedAt,
      });
      return {
        nonce,
        domain: parsedOrigin.host,
        uri: parsedOrigin.origin,
        chainId: services.config.GIWA_CHAIN_ID,
        issuedAt: issuedAt.toISOString(),
        expirationTime: expiresAt.toISOString(),
        statement: siweStatement,
      };
    },
  );

  app.post(
    '/v1/auth/verify',
    {
      schema: {
        tags: ['Authentication'],
        summary: 'Verify a SIWE signature and create a secure session',
        body: verifyBody,
      },
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    },
    async (request, reply) => {
      const body = verifyBody.parse(request.body);
      const origin = requireAllowedOrigin(request.headers.origin, services.config);
      let message: SiweMessage;
      try {
        message = new SiweMessage(body.message);
      } catch {
        throw new HttpError(400, 'siwe_message_invalid', 'SIWE message is invalid');
      }
      const normalizedAddress = getAddress(message.address).toLowerCase();
      const nonceHash = secretDigest(message.nonce, services.config.sessionSecrets.siweNonce);
      const [nonce] = await services.db
        .select()
        .from(authNonces)
        .where(
          and(
            eq(authNonces.nonceHash, nonceHash),
            eq(authNonces.walletAddress, normalizedAddress),
            isNull(authNonces.usedAt),
            gt(authNonces.expiresAt, new Date()),
          ),
        )
        .limit(1);
      if (!nonce) {
        throw new HttpError(
          401,
          'siwe_nonce_invalid',
          'SIWE nonce is invalid, expired, or already used',
        );
      }
      const originUrl = new URL(origin);
      const issuedAt = Date.parse(message.issuedAt ?? '');
      const expirationTime = Date.parse(message.expirationTime ?? '');
      if (
        message.domain !== nonce.domain ||
        message.uri !== nonce.uri ||
        originUrl.host !== nonce.domain ||
        message.chainId !== nonce.chainId ||
        message.statement !== siweStatement ||
        issuedAt !== nonce.createdAt.getTime() ||
        expirationTime !== nonce.expiresAt.getTime()
      ) {
        throw new HttpError(
          401,
          'siwe_context_mismatch',
          'SIWE domain, URI, chain, statement, or time window does not match the nonce',
        );
      }
      let verified = false;
      try {
        const result = await message.verify({
          signature: body.signature,
          domain: nonce.domain,
          nonce: message.nonce,
          time: new Date().toISOString(),
        });
        verified = result.success;
      } catch {
        verified = false;
      }
      if (!verified) {
        try {
          verified = await services.chainClient.verifyMessage({
            address: normalizedAddress as Address,
            message: body.message,
            signature: body.signature as `0x${string}`,
          });
        } catch {
          verified = false;
        }
      }
      if (!verified) {
        throw new HttpError(401, 'siwe_signature_invalid', 'SIWE signature is invalid');
      }
      const identity = await readAdminMerchantIdentity(
        services,
        normalizedAddress as Address,
        true,
      );
      const consumed = await services.db
        .update(authNonces)
        .set({ usedAt: new Date() })
        .where(and(eq(authNonces.id, nonce.id), isNull(authNonces.usedAt)))
        .returning({ id: authNonces.id });
      if (consumed.length !== 1) {
        throw new HttpError(409, 'siwe_nonce_replayed', 'SIWE nonce was already consumed');
      }

      const sessionToken = randomToken();
      const csrfToken = randomToken();
      const merchant = await services.db.transaction(async (tx) => {
        const [byIdentity] = await tx
          .select()
          .from(merchants)
          .where(eq(merchants.onchainMerchantAddress, identity.merchantAddress))
          .limit(1);
        const [byAdmin] = await tx
          .select()
          .from(merchants)
          .where(eq(merchants.adminAddress, normalizedAddress))
          .limit(1);
        if (byAdmin && byIdentity && byAdmin.id !== byIdentity.id) {
          throw new HttpError(
            409,
            'merchant_identity_conflict',
            'This wallet already belongs to a different merchant record',
          );
        }
        let current = byIdentity ?? byAdmin;
        if (current && current.onchainMerchantAddress !== identity.merchantAddress) {
          throw new HttpError(
            409,
            'merchant_identity_conflict',
            'This wallet already belongs to a different merchant record',
          );
        }
        if (!current) {
          [current] = await tx
            .insert(merchants)
            .values({
              onchainMerchantAddress: identity.merchantAddress,
              adminAddress: normalizedAddress,
              payoutAddress: normalizedAddress,
              settings: { displayName: 'New merchant' },
            })
            .returning();
        } else if (current.adminAddress !== normalizedAddress) {
          await tx
            .update(sessions)
            .set({ revokedAt: new Date() })
            .where(
              and(
                eq(sessions.merchantId, current.id),
                ne(sessions.walletAddress, normalizedAddress),
              ),
            );
          [current] = await tx
            .update(merchants)
            .set({ adminAddress: normalizedAddress, updatedAt: new Date() })
            .where(eq(merchants.id, current.id))
            .returning();
        }
        if (!current) throw new Error('Merchant upsert did not return a row');
        const [createdSession] = await tx
          .insert(sessions)
          .values({
            merchantId: current.id,
            walletAddress: normalizedAddress,
            tokenHash: secretDigest(sessionToken, services.config.sessionSecrets.sessionToken),
            csrfHash: secretDigest(csrfToken, services.config.sessionSecrets.csrf),
            expiresAt: new Date(Date.now() + services.config.SESSION_TTL_SECONDS * 1_000),
          })
          .returning({ id: sessions.id });
        if (!createdSession) throw new Error('Session insert did not return a row');
        return current;
      });

      reply.setCookie(sessionCookie, sessionToken, sessionCookieOptions(services, true));
      reply.setCookie(csrfCookie, csrfToken, sessionCookieOptions(services, false));
      return {
        merchant: serializeMerchant(merchant),
        csrfToken,
      };
    },
  );

  app.post(
    '/v1/auth/logout',
    {
      preHandler: [authenticate(services), protectMutation(services)],
      schema: { tags: ['Authentication'], summary: 'Revoke the active session' },
    },
    async (request, reply) => {
      if (request.principal?.sessionId) {
        await services.db
          .update(sessions)
          .set({ revokedAt: new Date() })
          .where(eq(sessions.id, request.principal.sessionId));
      }
      reply.clearCookie(sessionCookie, sessionCookieOptions(services, true));
      reply.clearCookie(csrfCookie, sessionCookieOptions(services, false));
      reply.code(204).send();
    },
  );
}

export function serializeMerchant(merchant: typeof merchants.$inferSelect) {
  return {
    id: merchant.id,
    onchainMerchantAddress: merchant.onchainMerchantAddress,
    adminAddress: merchant.adminAddress,
    payoutAddress: merchant.payoutAddress,
    delegatedSignerAddress: merchant.delegatedSignerAddress,
    refundOperatorAddress: merchant.refundOperatorAddress,
    status: merchant.status,
    onchainRegisteredAt: merchant.onchainRegisteredAt?.toISOString() ?? null,
    displayName: merchant.settings.displayName,
    createdAt: merchant.createdAt.toISOString(),
    updatedAt: merchant.updatedAt.toISOString(),
  };
}
