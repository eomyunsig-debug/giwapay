import * as Sentry from '@sentry/node';
import { randomUUID } from 'node:crypto';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import Fastify from 'fastify';
import {
  hasZodFastifySchemaValidationErrors,
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
} from 'fastify-type-provider-zod';
import { sql } from '@giwapay/db';

import { registerAuthRoutes } from './auth.js';
import { HttpError } from './errors.js';
import { readRouterConfiguration } from './router-readiness.js';
import { registerMerchantRoutes } from './routes/merchants.js';
import { registerPaymentMethodRoutes } from './routes/payment-methods.js';
import { registerPaymentIntentRoutes } from './routes/payment-intents.js';
import { registerWebhookRoutes } from './routes/webhooks.js';
import type { AppServices } from './types.js';

export async function buildApp(services: AppServices) {
  if (services.config.SENTRY_DSN) {
    Sentry.init({
      dsn: services.config.SENTRY_DSN,
      environment: services.config.SENTRY_ENVIRONMENT,
      sendDefaultPii: false,
    });
  }

  const app = Fastify({
    trustProxy:
      services.config.trustedProxyCidrs.length > 0 ? services.config.trustedProxyCidrs : false,
    bodyLimit: 256 * 1_024,
    requestIdHeader: 'x-request-id',
    genReqId: () => randomUUID(),
    logger: {
      level: services.config.LOG_LEVEL,
      redact: {
        paths: [
          'req.headers.authorization',
          'req.headers.cookie',
          'req.headers.x-csrf-token',
          'res.headers.set-cookie',
          'body.signature',
          'body.message',
        ],
        censor: '[REDACTED]',
      },
    },
  });

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  await app.register(cookie);
  await app.register(helmet, {
    contentSecurityPolicy: false,
    hsts:
      services.config.NODE_ENV === 'production'
        ? { maxAge: 31_536_000, includeSubDomains: true }
        : false,
    referrerPolicy: { policy: 'no-referrer' },
  });
  await app.register(cors, {
    credentials: true,
    methods: ['GET', 'HEAD', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'authorization',
      'content-type',
      'idempotency-key',
      'x-csrf-token',
      'x-request-id',
    ],
    origin(origin, callback) {
      if (!origin) {
        callback(null, true);
        return;
      }
      try {
        callback(null, services.config.allowedOrigins.includes(new URL(origin).origin));
      } catch {
        callback(null, false);
      }
    },
  });
  await app.register(rateLimit, {
    global: true,
    max: 200,
    timeWindow: '1 minute',
    keyGenerator: (request) => request.ip,
  });
  await app.register(swagger, {
    openapi: {
      info: {
        title: 'GiwaPay API',
        version: '0.1.0',
        description:
          'Non-custodial exact-settlement orchestration. A payment is successful only after confirmed chain-event verification.',
      },
      servers: [
        {
          url: services.config.PUBLIC_API_URL,
          description:
            services.config.NODE_ENV === 'production' ? 'Configured deployment' : 'Testnet demo',
        },
      ],
      components: {
        securitySchemes: {
          apiKey: { type: 'http', scheme: 'bearer' },
          merchantSession: { type: 'apiKey', in: 'cookie', name: 'giwapay_session' },
        },
      },
      tags: [
        { name: 'Authentication' },
        { name: 'Merchants' },
        { name: 'API keys' },
        { name: 'Payment intents' },
        { name: 'Checkout' },
        { name: 'Refunds' },
        { name: 'Webhooks' },
        { name: 'Operations' },
      ],
    },
    transform: jsonSchemaTransform,
  });
  if (services.config.exposeApiDocs) {
    await app.register(swaggerUi, {
      routePrefix: '/docs',
      uiConfig: { docExpansion: 'list', deepLinking: true },
      staticCSP: true,
    });
  }

  app.get(
    '/health',
    {
      schema: {
        tags: ['Operations'],
        summary: 'Process liveness',
      },
    },
    async () => ({
      status: 'ok',
      service: 'giwapay-api',
      timestamp: new Date().toISOString(),
    }),
  );

  app.get(
    '/ready',
    {
      schema: {
        tags: ['Operations'],
        summary: 'Database, chain, and signer readiness',
      },
    },
    async (_request, reply) => {
      const checks: Record<string, string> = {};
      try {
        await services.db.execute(sql`select 1`);
        checks.database = 'ok';
      } catch {
        checks.database = 'unavailable';
      }
      try {
        const chainId = await services.chainClient.getChainId();
        checks.chain = chainId === services.config.GIWA_CHAIN_ID ? 'ok' : 'wrong_chain';
      } catch {
        checks.chain = 'unavailable';
      }
      checks.intentSigner = (await services.intentSigner.readiness()) ? 'ok' : 'unconfigured';
      try {
        const router = await readRouterConfiguration(services);
        checks.routerConfiguration = router.matches ? 'ok' : 'mismatch';
      } catch {
        checks.routerConfiguration = 'unavailable';
      }
      const ready = Object.values(checks).every((value) => value === 'ok');
      reply.code(ready ? 200 : 503);
      return { status: ready ? 'ready' : 'not_ready', checks };
    },
  );

  if (services.config.exposeApiDocs) {
    app.get('/openapi.json', { schema: { hide: true } }, async () => app.swagger());
  }

  await registerAuthRoutes(app, services);
  await registerMerchantRoutes(app, services);
  await registerPaymentMethodRoutes(app, services);
  await registerPaymentIntentRoutes(app, services);
  await registerWebhookRoutes(app, services);

  app.setNotFoundHandler((_request, reply) => {
    reply.code(404).send({
      error: {
        code: 'route_not_found',
        message: 'Route was not found',
      },
    });
  });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof HttpError) {
      reply.code(error.statusCode).send({
        error: { code: error.code, message: error.message },
        requestId: request.id,
      });
      return;
    }
    if (
      typeof error === 'object' &&
      error !== null &&
      'statusCode' in error &&
      error.statusCode === 429
    ) {
      reply.code(429).send({
        error: {
          code: 'rate_limit_exceeded',
          message: 'Request rate limit exceeded',
        },
        requestId: request.id,
      });
      return;
    }
    if (hasZodFastifySchemaValidationErrors(error)) {
      reply.code(400).send({
        error: {
          code: 'request_validation_failed',
          message: 'Request validation failed',
          issues: error.validation,
        },
        requestId: request.id,
      });
      return;
    }
    request.log.error({ err: error }, 'Unhandled request error');
    if (services.config.SENTRY_DSN) Sentry.captureException(error);
    reply.code(500).send({
      error: {
        code: 'internal_error',
        message: 'An internal error occurred',
      },
      requestId: request.id,
    });
  });

  return app;
}
