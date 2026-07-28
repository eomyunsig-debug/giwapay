import { and, desc, eq, webhookDeliveries, webhookEndpoints, webhookEvents } from '@giwapay/db';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { authenticate, protectMutation } from '../auth.js';
import { encryptSecret, randomToken } from '../crypto.js';
import { HttpError } from '../errors.js';
import { assertSafeWebhookUrl } from '../http-security.js';
import type { AppServices } from '../types.js';

const createBody = z.object({
  url: z.string().url().max(2_048),
  description: z.string().trim().max(200).optional(),
});
const idParams = z.object({ id: z.uuid() });

function serializeEndpoint(endpoint: typeof webhookEndpoints.$inferSelect) {
  return {
    id: endpoint.id,
    url: endpoint.url,
    description: endpoint.description,
    enabled: endpoint.enabled,
    secretHint: `****${endpoint.secretLastFour}`,
    createdAt: endpoint.createdAt.toISOString(),
    updatedAt: endpoint.updatedAt.toISOString(),
  };
}

export async function registerWebhookRoutes(app: FastifyInstance, services: AppServices) {
  app.get(
    '/v1/webhook-endpoints',
    {
      preHandler: [authenticate(services, 'webhooks:write')],
      schema: { tags: ['Webhooks'], summary: 'List webhook endpoints' },
    },
    async (request) => {
      const principal = request.principal;
      if (!principal) throw new Error('Authentication pre-handler did not run');
      const rows = await services.db
        .select()
        .from(webhookEndpoints)
        .where(eq(webhookEndpoints.merchantId, principal.merchantId))
        .orderBy(desc(webhookEndpoints.createdAt));
      return { data: rows.map(serializeEndpoint) };
    },
  );

  app.post(
    '/v1/webhook-endpoints',
    {
      preHandler: [authenticate(services, 'webhooks:write'), protectMutation(services)],
      schema: {
        tags: ['Webhooks'],
        summary: 'Create a signed webhook endpoint',
        body: createBody,
      },
    },
    async (request, reply) => {
      const principal = request.principal;
      if (!principal) throw new Error('Authentication pre-handler did not run');
      const body = createBody.parse(request.body);
      const safeUrl = await assertSafeWebhookUrl(
        body.url,
        services.config.NODE_ENV === 'production',
      );
      const secret = `whsec_${randomToken(32)}`;
      const [endpoint] = await services.db
        .insert(webhookEndpoints)
        .values({
          merchantId: principal.merchantId,
          url: safeUrl.toString(),
          ...(body.description ? { description: body.description } : {}),
          secretCiphertext: encryptSecret(secret, services.config.webhookKey),
          secretLastFour: secret.slice(-4),
        })
        .returning();
      if (!endpoint) throw new Error('Webhook insert did not return a row');
      reply.code(201);
      return { endpoint: serializeEndpoint(endpoint), secret };
    },
  );

  app.delete(
    '/v1/webhook-endpoints/:id',
    {
      preHandler: [authenticate(services, 'webhooks:write'), protectMutation(services)],
      schema: {
        tags: ['Webhooks'],
        summary: 'Disable a webhook endpoint',
        params: idParams,
      },
    },
    async (request, reply) => {
      const principal = request.principal;
      if (!principal) throw new Error('Authentication pre-handler did not run');
      const { id } = idParams.parse(request.params);
      const disabled = await services.db
        .update(webhookEndpoints)
        .set({ enabled: false, updatedAt: new Date() })
        .where(
          and(eq(webhookEndpoints.id, id), eq(webhookEndpoints.merchantId, principal.merchantId)),
        )
        .returning({ id: webhookEndpoints.id });
      if (disabled.length === 0) {
        throw new HttpError(404, 'webhook_endpoint_not_found', 'Webhook endpoint was not found');
      }
      reply.code(204).send();
    },
  );

  app.get(
    '/v1/webhook-deliveries',
    {
      preHandler: [authenticate(services, 'webhooks:write')],
      schema: {
        tags: ['Webhooks'],
        summary: 'List recent webhook delivery attempts',
      },
    },
    async (request) => {
      const principal = request.principal;
      if (!principal) throw new Error('Authentication pre-handler did not run');
      const rows = await services.db
        .select({
          delivery: webhookDeliveries,
          event: webhookEvents,
          endpoint: webhookEndpoints,
        })
        .from(webhookDeliveries)
        .innerJoin(webhookEvents, eq(webhookEvents.id, webhookDeliveries.eventId))
        .innerJoin(webhookEndpoints, eq(webhookEndpoints.id, webhookDeliveries.endpointId))
        .where(eq(webhookEvents.merchantId, principal.merchantId))
        .orderBy(desc(webhookDeliveries.createdAt))
        .limit(100);
      return {
        data: rows.map(({ delivery, event, endpoint }) => ({
          id: delivery.id,
          eventId: event.id,
          eventType: event.eventType,
          endpointId: endpoint.id,
          endpointUrl: endpoint.url,
          status: delivery.status,
          attemptCount: delivery.attemptCount,
          responseStatus: delivery.responseStatus,
          lastError: delivery.lastError,
          deliveredAt: delivery.deliveredAt?.toISOString() ?? null,
          nextAttemptAt: delivery.nextAttemptAt.toISOString(),
          createdAt: delivery.createdAt.toISOString(),
        })),
      };
    },
  );
}
