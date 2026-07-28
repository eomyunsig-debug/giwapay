import {
  and,
  eq,
  inArray,
  isNull,
  lte,
  or,
  sql,
  webhookDeliveries,
  webhookEndpoints,
  webhookEvents,
} from '@giwapay/db';
import type { LookupFunction } from 'node:net';
import type { Logger } from 'pino';
import { Agent, fetch as undiciFetch } from 'undici';

import { decryptSecret, signWebhook } from './crypto.js';
import { resolveSafeWebhookTarget } from './http-security.js';
import type { AppServices } from './types.js';

export type ClaimedDelivery = {
  delivery: typeof webhookDeliveries.$inferSelect;
  event: typeof webhookEvents.$inferSelect;
  endpoint: typeof webhookEndpoints.$inferSelect;
};

const WEBHOOK_LEASE_MINIMUM_MS = 120_000;
const WEBHOOK_LEASE_SAFETY_MARGIN_MS = 60_000;

export function webhookLeaseDurationMs(deliveryTimeoutMs: number): number {
  return Math.max(WEBHOOK_LEASE_MINIMUM_MS, deliveryTimeoutMs + WEBHOOK_LEASE_SAFETY_MARGIN_MS);
}

function claimedDeliveryPredicate(delivery: ClaimedDelivery['delivery']) {
  if (!delivery.leaseExpiresAt) {
    throw new Error('Claimed webhook delivery is missing its lease expiry');
  }
  return and(
    eq(webhookDeliveries.id, delivery.id),
    eq(webhookDeliveries.status, 'processing'),
    eq(webhookDeliveries.attemptCount, delivery.attemptCount),
    eq(webhookDeliveries.leaseExpiresAt, delivery.leaseExpiresAt),
  );
}

export async function claimWebhookDeliveries(
  services: AppServices,
  limit = 20,
): Promise<ClaimedDelivery[]> {
  const now = new Date();
  const leaseExpiresAt = new Date(
    now.getTime() + webhookLeaseDurationMs(services.config.WEBHOOK_TIMEOUT_MS),
  );
  return services.db.transaction(async (tx) => {
    const rows = await tx
      .select({
        delivery: webhookDeliveries,
        event: webhookEvents,
        endpoint: webhookEndpoints,
      })
      .from(webhookDeliveries)
      .innerJoin(webhookEvents, eq(webhookEvents.id, webhookDeliveries.eventId))
      .innerJoin(webhookEndpoints, eq(webhookEndpoints.id, webhookDeliveries.endpointId))
      .where(
        and(
          eq(webhookEndpoints.enabled, true),
          or(
            and(
              inArray(webhookDeliveries.status, ['pending', 'retry']),
              lte(webhookDeliveries.nextAttemptAt, now),
            ),
            and(
              eq(webhookDeliveries.status, 'processing'),
              or(
                isNull(webhookDeliveries.leaseExpiresAt),
                lte(webhookDeliveries.leaseExpiresAt, now),
              ),
            ),
          ),
        ),
      )
      .limit(limit)
      .for('update', { skipLocked: true });

    const claimed: ClaimedDelivery[] = [];
    for (const row of rows) {
      const updated = await tx
        .update(webhookDeliveries)
        .set({
          status: 'processing',
          attemptCount: sql`${webhookDeliveries.attemptCount} + 1`,
          leaseExpiresAt,
          updatedAt: now,
        })
        .where(eq(webhookDeliveries.id, row.delivery.id))
        .returning();
      const delivery = updated[0];
      if (delivery) claimed.push({ ...row, delivery });
    }
    return claimed;
  });
}

async function readLimitedResponse(
  response: Awaited<ReturnType<typeof undiciFetch>>,
): Promise<string> {
  if (!response.body) return '';
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let output = '';
  while (output.length < 1_000) {
    const result = await reader.read();
    if (result.done) break;
    output += decoder.decode(result.value, { stream: true });
  }
  await reader.cancel().catch(() => undefined);
  return output.slice(0, 1_000);
}

export async function deliverWebhook(
  services: AppServices,
  claimed: ClaimedDelivery,
  logger: Logger,
) {
  const { delivery, endpoint, event } = claimed;
  let responseStatus: number | null = null;
  let responseBody: string | null = null;
  let errorMessage: string | null = null;
  let dispatcher: Agent | undefined;
  try {
    const target = await resolveSafeWebhookTarget(
      endpoint.url,
      services.config.NODE_ENV === 'production',
    );
    const pinnedLookup = ((
      _hostname: string,
      options: number | { family?: number; all?: boolean },
      callback: (...arguments_: unknown[]) => void,
    ) => {
      const family = typeof options === 'number' ? options : (options.family ?? 0);
      const candidates = target.addresses.filter(
        (entry) => family === 0 || entry.family === family,
      );
      const selected = candidates[0];
      if (!selected) {
        callback(
          Object.assign(new Error('No pinned webhook address for family'), {
            code: 'ENOTFOUND',
          }),
        );
      } else if (typeof options !== 'number' && options.all) {
        callback(null, candidates);
      } else {
        callback(null, selected.address, selected.family);
      }
    }) as unknown as LookupFunction;
    dispatcher = new Agent({ connect: { lookup: pinnedLookup } });
    const rawBody = JSON.stringify(event.payload);
    const timestamp = Math.floor(Date.now() / 1_000);
    const secret = decryptSecret(endpoint.secretCiphertext, services.config.webhookKey);
    const response = await undiciFetch(target.url, {
      method: 'POST',
      redirect: 'manual',
      signal: AbortSignal.timeout(services.config.WEBHOOK_TIMEOUT_MS),
      headers: {
        'content-type': 'application/json',
        'user-agent': 'GiwaPay-Webhooks/0.1',
        'idempotency-key': event.id,
        'giwapay-event-id': event.id,
        'giwapay-signature': signWebhook(timestamp, rawBody, secret),
      },
      body: rawBody,
      dispatcher,
    });
    responseStatus = response.status;
    responseBody = await readLimitedResponse(response);
    if (response.status < 200 || response.status >= 300) {
      errorMessage = `HTTP ${response.status}`;
    }
  } catch (error) {
    errorMessage = error instanceof Error ? error.message.slice(0, 1_000) : 'Delivery failed';
  } finally {
    await dispatcher?.close().catch(() => undefined);
  }

  if (!errorMessage) {
    const updated = await services.db
      .update(webhookDeliveries)
      .set({
        status: 'succeeded',
        responseStatus,
        responseBody,
        lastError: null,
        deliveredAt: new Date(),
        leaseExpiresAt: null,
        updatedAt: new Date(),
      })
      .where(claimedDeliveryPredicate(delivery))
      .returning({ id: webhookDeliveries.id });
    if (updated.length === 0) {
      logger.warn(
        {
          deliveryId: delivery.id,
          eventId: event.id,
          attempt: delivery.attemptCount,
        },
        'Ignored stale webhook delivery success',
      );
      return;
    }
    logger.info(
      { deliveryId: delivery.id, eventId: event.id, responseStatus },
      'Webhook delivered',
    );
    return;
  }

  const deadLetter =
    delivery.attemptCount >= services.config.WEBHOOK_MAX_ATTEMPTS || responseStatus === 410;
  const exponentialSeconds = Math.min(3_600, 2 ** Math.max(0, delivery.attemptCount - 1) * 5);
  const jitterMilliseconds = Math.floor(Math.random() * 1_000);
  const updated = await services.db
    .update(webhookDeliveries)
    .set({
      status: deadLetter ? 'dead_letter' : 'retry',
      responseStatus,
      responseBody,
      lastError: errorMessage,
      nextAttemptAt: new Date(Date.now() + exponentialSeconds * 1_000 + jitterMilliseconds),
      leaseExpiresAt: null,
      updatedAt: new Date(),
    })
    .where(claimedDeliveryPredicate(delivery))
    .returning({ id: webhookDeliveries.id });
  if (updated.length === 0) {
    logger.warn(
      {
        deliveryId: delivery.id,
        eventId: event.id,
        attempt: delivery.attemptCount,
      },
      'Ignored stale webhook delivery failure',
    );
    return;
  }
  logger.warn(
    {
      deliveryId: delivery.id,
      eventId: event.id,
      attempt: delivery.attemptCount,
      deadLetter,
      responseStatus,
      error: errorMessage,
    },
    'Webhook delivery failed',
  );
}
