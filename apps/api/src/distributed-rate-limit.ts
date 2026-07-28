import type { Pool } from 'pg';

import { secretDigest } from './crypto.js';
import { HttpError } from './errors.js';

type RateLimitServices = {
  pool: Pool;
  config: {
    sessionSecrets: { quoteEnvelope: string };
  };
};

export async function enforceDistributedRateLimit(
  services: RateLimitServices,
  input: {
    scope: string;
    identity: string;
    maximum: number;
    now?: Date;
  },
): Promise<void> {
  const now = input.now ?? new Date();
  const windowStart = Math.floor(now.getTime() / 60_000);
  const rateKey = secretDigest(
    `${input.scope}:${input.identity}`,
    services.config.sessionSecrets.quoteEnvelope,
  );
  try {
    const result = await services.pool.query<{ request_count: number }>(
      `insert into request_rate_limits (
         rate_key, window_start, request_count, expires_at
       ) values ($1, $2, 1, $3)
       on conflict (rate_key, window_start)
       do update set request_count = request_rate_limits.request_count + 1
       returning request_count`,
      [rateKey, windowStart, new Date((windowStart + 2) * 60_000)],
    );
    if ((result.rows[0]?.request_count ?? input.maximum + 1) > input.maximum) {
      throw new HttpError(429, 'rate_limit_exceeded', 'Request rate limit exceeded');
    }
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(
      503,
      'rate_limit_unavailable',
      'Public request admission could not be verified',
      { cause: error },
    );
  }
}
