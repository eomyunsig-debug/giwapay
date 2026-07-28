import 'dotenv/config';

import { setTimeout as delay } from 'node:timers/promises';

import { createDatabase } from '@giwapay/db';
import pino from 'pino';

import { createChainClient } from './chain.js';
import { loadConfig } from './env.js';
import { PaymentIntentSigner } from './signer.js';
import type { AppServices } from './types.js';
import { claimWebhookDeliveries, deliverWebhook } from './webhooks.js';

const config = loadConfig();
const database = createDatabase(config.DATABASE_URL);
const logger = pino({
  level: config.LOG_LEVEL,
  redact: ['secret', 'authorization', 'cookie'],
});
const services: AppServices = {
  config,
  db: database.db,
  pool: database.pool,
  chainClient: createChainClient(config),
  intentSigner: new PaymentIntentSigner(config),
};
let stopping = false;

process.once('SIGINT', () => {
  stopping = true;
});
process.once('SIGTERM', () => {
  stopping = true;
});

logger.info('GiwaPay webhook worker started');
while (!stopping) {
  try {
    const deliveries = await claimWebhookDeliveries(services);
    if (deliveries.length === 0) {
      await delay(config.WEBHOOK_POLL_INTERVAL_MS);
      continue;
    }
    await Promise.all(deliveries.map((delivery) => deliverWebhook(services, delivery, logger)));
  } catch (error) {
    logger.error({ err: error }, 'Webhook worker iteration failed');
    await delay(config.WEBHOOK_POLL_INTERVAL_MS);
  }
}

await database.close();
logger.info('GiwaPay webhook worker stopped');
