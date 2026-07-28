import { and, apiKeys, authNonces, eq, gt, isNull, merchants, sessions } from '@giwapay/db';
import type { FastifyInstance, FastifyRequest, preHandlerHookHandler } from 'fastify';
import { SiweMessage } from 'siwe';
import { getAddress } from 'viem';
import { z } from 'zod';

import { randomSiweNonce, randomToken, safeSecretEqual, secretDigest } from './crypto.js';
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
    await services.db.update(apiKeys).set({ lastUsedAt: new Date() }).where(eq(apiKeys.id, key.id));
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
  const tokenHash = secretDigest(token, services.config.SESSION_SECRET);
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
    if (!session || !safeSecretEqual(csrf, session.csrfHash, services.config.SESSION_SECRET)) {
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
        nonceHash: secretDigest(nonce, services.config.SESSION_SECRET),
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
      const nonceHash = secretDigest(message.nonce, services.config.SESSION_SECRET);
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
        throw new HttpError(401, 'siwe_signature_invalid', 'SIWE signature is invalid');
      }
      const consumed = await services.db
        .update(authNonces)
        .set({ usedAt: new Date() })
        .where(and(eq(authNonces.id, nonce.id), isNull(authNonces.usedAt)))
        .returning({ id: authNonces.id });
      if (consumed.length !== 1) {
        throw new HttpError(409, 'siwe_nonce_replayed', 'SIWE nonce was already consumed');
      }

      const [merchant] = await services.db
        .insert(merchants)
        .values({
          adminAddress: normalizedAddress,
          payoutAddress: normalizedAddress,
          settings: { displayName: 'New merchant' },
        })
        .onConflictDoUpdate({
          target: merchants.adminAddress,
          set: { updatedAt: new Date() },
        })
        .returning();
      if (!merchant) {
        throw new Error('Merchant upsert did not return a row');
      }

      const sessionToken = randomToken();
      const csrfToken = randomToken();
      const [session] = await services.db
        .insert(sessions)
        .values({
          merchantId: merchant.id,
          tokenHash: secretDigest(sessionToken, services.config.SESSION_SECRET),
          csrfHash: secretDigest(csrfToken, services.config.SESSION_SECRET),
          expiresAt: new Date(Date.now() + services.config.SESSION_TTL_SECONDS * 1_000),
        })
        .returning({ id: sessions.id });
      if (!session) throw new Error('Session insert did not return a row');

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
