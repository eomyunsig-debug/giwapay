import type { Pool } from 'pg';
import { describe, expect, it } from 'vitest';

import { enforceDistributedRateLimit } from './distributed-rate-limit.js';

describe('distributed public rate limit', () => {
  it('hashes the identity and rejects counts above the shared limit', async () => {
    let count = 0;
    let parameters: readonly unknown[] = [];
    const pool = {
      query: async (_statement: string, values: readonly unknown[]) => {
        parameters = values;
        count += 1;
        return { rows: [{ request_count: count }] };
      },
    } as unknown as Pool;
    const services = {
      pool,
      config: {
        sessionSecrets: { quoteEnvelope: Buffer.alloc(32, 7).toString('base64url') },
      },
    };
    const input = {
      scope: 'quote',
      identity: '203.0.113.1:payment-id',
      maximum: 2,
      now: new Date('2026-07-28T00:00:01.000Z'),
    };

    await enforceDistributedRateLimit(services, input);
    await enforceDistributedRateLimit(services, input);
    await expect(enforceDistributedRateLimit(services, input)).rejects.toMatchObject({
      statusCode: 429,
      code: 'rate_limit_exceeded',
    });
    expect(parameters[0]).toMatch(/^[0-9a-f]{64}$/);
    expect(String(parameters[0])).not.toContain(input.identity);
  });

  it('fails closed when the shared store is unavailable', async () => {
    const pool = {
      query: async () => {
        throw new Error('database unavailable');
      },
    } as unknown as Pool;
    await expect(
      enforceDistributedRateLimit(
        {
          pool,
          config: {
            sessionSecrets: { quoteEnvelope: Buffer.alloc(32, 8).toString('base64url') },
          },
        },
        { scope: 'prepare', identity: 'test', maximum: 1 },
      ),
    ).rejects.toMatchObject({ statusCode: 503, code: 'rate_limit_unavailable' });
  });
});
