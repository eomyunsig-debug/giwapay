import 'dotenv/config';

import { setTimeout as delay } from 'node:timers/promises';

import { createDatabase } from '@giwapay/db';
import pino from 'pino';

import { createChainClient } from './chain.js';
import { loadConfig } from './env.js';
import { ChainIndexer } from './indexer-service.js';
import { DatabaseMerchantSignerKeyStore } from './signer-key-store.js';
import { PaymentIntentSigner } from './signer.js';
import type { AppServices } from './types.js';

const config = loadConfig();
const database = createDatabase(config.DATABASE_URL);
const logger = pino({ level: config.LOG_LEVEL });
const services: AppServices = {
  config,
  db: database.db,
  pool: database.pool,
  chainClient: createChainClient(config),
  intentSigner: new PaymentIntentSigner(
    config,
    undefined,
    new DatabaseMerchantSignerKeyStore(database.db),
  ),
};
const lockClient = await database.pool.connect();
const lockResult = await lockClient.query<{ acquired: boolean }>(
  'select pg_try_advisory_lock($1) as acquired',
  [91_342_001],
);
if (!lockResult.rows[0]?.acquired) {
  logger.fatal('Another GiwaPay chain indexer holds the advisory lock');
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

const indexer = new ChainIndexer(services, logger);
logger.info(
  {
    chainId: config.GIWA_CHAIN_ID,
    confirmations: config.CHAIN_CONFIRMATIONS,
    startBlock: config.CHAIN_START_BLOCK.toString(),
  },
  'GiwaPay chain indexer started',
);
while (!stopping) {
  try {
    const progressed = await indexer.next();
    if (!progressed) await delay(config.INDEXER_POLL_INTERVAL_MS);
  } catch (error) {
    logger.error({ err: error }, 'Chain indexer iteration failed');
    await delay(config.INDEXER_POLL_INTERVAL_MS);
  }
}

await lockClient.query('select pg_advisory_unlock($1)', [91_342_001]);
lockClient.release();
await database.close();
logger.info('GiwaPay chain indexer stopped');
