import 'dotenv/config';

import { setTimeout as delay } from 'node:timers/promises';

import { createDatabase } from '@giwapay/db';
import pino from 'pino';

import { loadConfig } from './env.js';
import { runRetentionCycle } from './retention.js';

const config = loadConfig();
const database = createDatabase(config.DATABASE_URL);
const logger = pino({ level: config.LOG_LEVEL });
const lockClient = await database.pool.connect();
const lock = await lockClient.query<{ acquired: boolean }>(
  'select pg_try_advisory_lock($1) as acquired',
  [91_342_003],
);
if (!lock.rows[0]?.acquired) {
  logger.fatal('Another GiwaPay retention worker holds the advisory lock');
  lockClient.release();
  await database.close();
  process.exit(1);
}

let stopping = false;
process.once('SIGINT', () => {
  stopping = true;
});
process.once('SIGTERM', () => {
  stopping = true;
});

logger.info('GiwaPay retention worker started');
while (!stopping) {
  try {
    const deleted = await runRetentionCycle({ config, pool: database.pool });
    logger.info({ deleted }, 'Retention cycle completed');
  } catch (error) {
    logger.error({ err: error }, 'Retention cycle failed');
  }
  if (!stopping) await delay(config.RETENTION_POLL_INTERVAL_MS);
}

await lockClient.query('select pg_advisory_unlock($1)', [91_342_003]);
lockClient.release();
await database.close();
logger.info('GiwaPay retention worker stopped');
