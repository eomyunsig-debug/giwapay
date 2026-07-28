import { migrate } from 'drizzle-orm/node-postgres/migrator';

import { createDatabase } from './index.js';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error('DATABASE_URL is required');
}

const handle = createDatabase(databaseUrl, { max: 1 });

try {
  await migrate(handle.db, {
    migrationsFolder: new URL('../migrations', import.meta.url).pathname,
  });
} finally {
  await handle.close();
}
