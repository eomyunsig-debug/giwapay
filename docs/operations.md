# Operations runbook

## Processes

Run these as separately supervised services:

- `@giwapay/api start:server`
- `@giwapay/api start:indexer`
- `@giwapay/api start:webhooks`

Apply reviewed migrations once before starting a new application release. The
checked-in `0000_initial.sql` is only for a fresh, empty database; it is not an
upgrade for retained or hand-created schemas. All processes use PostgreSQL;
Redis is not required.

## Health

- `/health` proves only that the API process is alive.
- `/ready` must report database, chain ID, contract configuration, signer, and
  adapter dependencies as ready before traffic.

Alert on:

- readiness failures or RPC fallback exhaustion;
- indexer cursor lag beyond the confirmation depth and polling budget;
- canonical rollback or no common ancestor within the configured lookback;
- rejected logs that conflict with stored signed intent terms;
- payments rejected because `SettlementDistributed` logs do not reproduce the
  exact registered distribution;
- webhook retry/dead-letter growth;
- API 5xx/429 rates and database saturation.

Optional Sentry reporting activates only when its DSN is configured and does
not send default PII. Structured logs redact authorization, cookies, CSRF
tokens, SIWE messages/signatures, and secrets.

## Backups and recovery

Back up PostgreSQL with point-in-time recovery appropriate for the environment.
Restore drills must verify:

1. migration journal and schema;
2. cursor and stored block hashes;
3. chain-event uniqueness;
4. PaymentIntent/refund projections;
5. encrypted webhook secrets with the original encryption key.

If the projection is lost, stop webhook delivery, restore or rebuild from the
reviewed `CHAIN_START_BLOCK`, compare event counts, and only then resume.
Rotating `WEBHOOK_ENCRYPTION_KEY` requires an explicit re-encryption procedure;
changing it without migration makes endpoints unusable.

## Key rotation

- Merchant admins rotate/revoke delegated signers on-chain. Pending signatures
  from the old signer fail at the router.
- API keys are independently revocable and should be scoped and short-lived.
- Session/API pepper changes revoke existing material.
- PaymentIntent signer rotation requires every merchant to register the new
  address before the service signs new intents.
- Contract owner/adapter-manager transfer uses the on-chain two-step flow and
  must be verified before the old operator relinquishes access. On
  `AdapterRegistry.acceptOwnership`, the contract automatically revokes any
  adapter-manager authority held by the previous owner; verify both the new
  owner and the old owner's revoked manager state.

Never log, paste into tickets, or commit the material itself.

## Incident controls

- **Suspicious adapter:** adapter manager disables it; router owner may pause
  new payments. Refunds remain available.
- **Delegated signer leak:** merchants revoke/rotate it; stop API signing; do
  not alter payout/splits.
- **RPC disagreement:** fail readiness and signing/quotes; compare independent
  providers and stored block hashes.
- **Webhook compromise:** disable endpoint, rotate its secret by creating a new
  endpoint, and replay only reviewed event IDs.
- **Reorg:** keep the indexer stopped if no common ancestor is found; do not
  manually mark payments successful. A rolled-back refund returns to
  `submitted`; pending stale success deliveries become `dead_letter`, and
  consumers must apply the corresponding `refund.reorged` or
  `payment.reorged` compensation before acting on replacements.
- **Pending refund:** resume only the same `(merchant, intentId, refundId)`.
  Do not prepare a replacement merely because a transaction is absent from one
  RPC view; issued calldata cannot be revoked off-chain.

The contracts are non-upgradeable. Emergency pause is a containment measure,
not an assertion that funds or legal obligations have been resolved.
