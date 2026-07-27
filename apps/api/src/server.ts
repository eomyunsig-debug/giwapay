import 'dotenv/config';

import { createDatabase } from '@giwapay/db';

import { buildApp } from './app.js';
import { createChainClient } from './chain.js';
import { loadConfig } from './env.js';
import { PaymentIntentSigner } from './signer.js';

const config = loadConfig();
const database = createDatabase(config.DATABASE_URL);
const app = await buildApp({
  config,
  db: database.db,
  pool: database.pool,
  chainClient: createChainClient(config),
  intentSigner: new PaymentIntentSigner(config),
});

const shutdown = async (signal: string) => {
  app.log.info({ signal }, 'Shutting down');
  await app.close();
  await database.close();
  process.exit(0);
};

process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));

try {
  await app.listen({ host: config.HOST, port: config.PORT });
} catch (error) {
  app.log.fatal({ err: error }, 'API failed to start');
  await database.close();
  process.exit(1);
}
