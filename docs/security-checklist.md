# Security release checklist

- [ ] All Foundry unit, fuzz and invariant tests pass.
- [ ] Slither has no unexplained high/medium findings.
- [ ] Deployed bytecode matches reviewed non-upgradeable artifacts.
- [ ] Router EIP-712 domain, chain ID and deployed address are recorded.
- [ ] Merchant and adapter registry ownership transfers are complete.
- [ ] Delegated signer has no merchant-admin assets or permissions.
- [ ] Production deployment rejects test-only tokens and adapters.
- [ ] Two independent, authenticated RPC endpoints are configured.
- [ ] API/session/webhook/signer secrets come from a secret manager.
- [ ] Cookie domain, allowed origin, public URLs and proxy trust are reviewed.
- [ ] PostgreSQL TLS, backups, retention and least-privilege roles are enabled.
- [ ] Indexer confirmation depth, starting block and reorg alerts are reviewed.
- [ ] Payment receipts require a complete validated `SettlementDistributed`
      snapshot before success.
- [ ] Signed `splitHash` matches the reviewed recipient/bps snapshot.
- [ ] Webhook retry/dead-letter monitoring and consumer idempotency are tested.
- [ ] Pending refunds resume only the same `(merchant, intentId, refundId)`;
      no replacement is opened after executable calldata is issued.
- [ ] Reorg drills return refunds to `submitted`, invalidate stale success
      deliveries, and process both payment and refund compensation events.
- [ ] `ADAPTER_MANAGER_ADDRESS` is explicit; ownership acceptance revokes any
      manager permission retained by the previous owner.
- [ ] `0000_initial.sql` is applied only to a fresh database, never as an in-place upgrade.
- [ ] Rate limits, CSP/security headers, log redaction and Sentry scrubbing are tested.
- [ ] Restore, signer rotation, API-key revocation and emergency pause drills pass.
- [ ] No mainnet RPC, production wallet key, official-token claim or unlabelled mock remains.
