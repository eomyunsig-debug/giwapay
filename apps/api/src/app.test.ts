import type { Database } from '@giwapay/db';
import type { Pool } from 'pg';
import { describe, expect, it } from 'vitest';

import { buildApp } from './app.js';
import { loadConfig } from './env.js';
import type { AppServices } from './types.js';

function services(exposeApiDocs: boolean): AppServices {
  const config = loadConfig({
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    DATABASE_URL: 'postgresql://unused:unused@127.0.0.1:1/unused',
    ALLOWED_ORIGINS: 'http://localhost:3000',
    WEB_BASE_URL: 'http://localhost:3000',
    PUBLIC_API_URL: 'http://localhost:3001',
    SESSION_SECRET: 's'.repeat(32),
    API_KEY_PEPPER: 'p'.repeat(32),
    WEBHOOK_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64'),
    EXPOSE_API_DOCS: String(exposeApiDocs),
  });
  return {
    config,
    db: {} as Database,
    pool: {} as Pool,
    chainClient: {} as AppServices['chainClient'],
    intentSigner: {
      addressForMerchant: () => undefined,
      readiness: async () => false,
      sign: async () => {
        throw new Error('not configured');
      },
    },
  };
}

describe('API documentation exposure', () => {
  it('does not register the OpenAPI route when exposure is disabled', async () => {
    const app = await buildApp(services(false));
    const response = await app.inject({ method: 'GET', url: '/openapi.json' });
    expect(response.statusCode).toBe(404);
    await app.close();
  });

  it('serves generated OpenAPI only after explicit exposure', async () => {
    const app = await buildApp(services(true));
    const response = await app.inject({ method: 'GET', url: '/openapi.json' });
    expect(response.statusCode).toBe(200);
    expect(response.json().info.title).toBe('GiwaPay API');
    await app.close();
  });
});
