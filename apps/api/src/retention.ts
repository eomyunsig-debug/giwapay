import type { Pool } from 'pg';

import type { AppConfig } from './env.js';

type RetentionServices = {
  config: AppConfig;
  pool: Pool;
};

export type RetentionResult = {
  authNonces: number;
  sessions: number;
  webhookEvents: number;
  chainBlocks: number;
  requestRateLimits: number;
};

async function deleteRows(
  pool: Pool,
  statement: string,
  parameters: readonly unknown[],
): Promise<number> {
  const result = await pool.query(statement, [...parameters]);
  return result.rowCount ?? 0;
}

export async function runRetentionBatch(
  services: RetentionServices,
  now = new Date(),
): Promise<RetentionResult> {
  const authCutoff = new Date(
    now.getTime() - services.config.AUTH_RETENTION_DAYS * 24 * 60 * 60 * 1_000,
  );
  const webhookCutoff = new Date(
    now.getTime() - services.config.WEBHOOK_RETENTION_DAYS * 24 * 60 * 60 * 1_000,
  );
  const batchSize = services.config.RETENTION_BATCH_SIZE;
  const retainedBlocks =
    BigInt(services.config.REORG_LOOKBACK_BLOCKS) + BigInt(services.config.CHAIN_CONFIRMATIONS);

  const [authNonces, sessions, webhookEvents, chainBlocks, requestRateLimits] = await Promise.all([
    deleteRows(
      services.pool,
      `with doomed as (
         select id from auth_nonces
         where expires_at < $1 or used_at < $1
         order by created_at
         limit $2
       )
       delete from auth_nonces target using doomed
       where target.id = doomed.id`,
      [authCutoff, batchSize],
    ),
    deleteRows(
      services.pool,
      `with doomed as (
         select id from sessions
         where expires_at < $1 or revoked_at < $1
         order by created_at
         limit $2
       )
       delete from sessions target using doomed
       where target.id = doomed.id`,
      [authCutoff, batchSize],
    ),
    deleteRows(
      services.pool,
      `with doomed as (
         select we.id
         from webhook_events we
         where we.created_at < $1
           and not exists (
             select 1 from webhook_deliveries delivery
             where delivery.event_id = we.id
               and delivery.status not in ('succeeded', 'dead_letter')
           )
         order by we.created_at
         limit $2
       )
       delete from webhook_events target using doomed
       where target.id = doomed.id`,
      [webhookCutoff, batchSize],
    ),
    deleteRows(
      services.pool,
      `with floors as (
         select chain_id, greatest(0, min(next_block_number) - $1::bigint) as floor
         from chain_cursors
         group by chain_id
       ), doomed as (
         select cb.chain_id, cb.block_number
         from chain_blocks cb
         join floors on floors.chain_id = cb.chain_id
         where cb.block_number < floors.floor
         order by cb.chain_id, cb.block_number
         limit $2
       )
       delete from chain_blocks target using doomed
       where target.chain_id = doomed.chain_id
         and target.block_number = doomed.block_number`,
      [retainedBlocks.toString(), batchSize],
    ),
    deleteRows(
      services.pool,
      `with doomed as (
         select rate_key, window_start
         from request_rate_limits
         where expires_at < $1
         order by expires_at
         limit $2
       )
       delete from request_rate_limits target using doomed
       where target.rate_key = doomed.rate_key
         and target.window_start = doomed.window_start`,
      [now, batchSize],
    ),
  ]);

  return { authNonces, sessions, webhookEvents, chainBlocks, requestRateLimits };
}

export async function runRetentionCycle(
  services: RetentionServices,
  now = new Date(),
): Promise<RetentionResult> {
  const totals: RetentionResult = {
    authNonces: 0,
    sessions: 0,
    webhookEvents: 0,
    chainBlocks: 0,
    requestRateLimits: 0,
  };
  for (let iteration = 0; iteration < 20; iteration += 1) {
    const batch = await runRetentionBatch(services, now);
    totals.authNonces += batch.authNonces;
    totals.sessions += batch.sessions;
    totals.webhookEvents += batch.webhookEvents;
    totals.chainBlocks += batch.chainBlocks;
    totals.requestRateLimits += batch.requestRateLimits;
    if (Object.values(batch).every((count) => count < services.config.RETENTION_BATCH_SIZE)) {
      break;
    }
  }
  return totals;
}
