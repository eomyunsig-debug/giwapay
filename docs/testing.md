# Verification strategy

## Smart contracts

`packages/contracts/test` covers:

- merchant registration, payout/signer/refund roles, pause, and split rules;
- adapter EOA/code-hash/test-mode/pair/cap/pause/two-step-owner rules;
- direct and exact-output payments, exact fee and split distribution, unused
  refund, allowance reset, replay, expiry, and payer binding;
- canonical `SettlementDistributed` logs, zero-rounded recipients, and
  payment-time distribution integrity after registry changes;
- partial/full refunds, `(merchant, intentId, refundId)` replay protection, and
  cumulative caps;
- fee-on-transfer, lying/short-output adapters, reentrancy, and malicious
  contracts;
- fuzzed amounts/splits and handler invariants for accounting, zero retained
  balances, replay protection, and refund caps.

Local:

```sh
forge fmt --check
forge build --sizes
forge test -vv
FOUNDRY_PROFILE=ci forge test -vvv
```

CI additionally runs Slither with the reviewed repository configuration.
Passing automation is not an independent security audit.

## TypeScript and API

Vitest covers chain configuration/fallback, runtime environment rejection,
cryptography, ABI conformance, SDK validation/retry/idempotency, React
components, web formatting, and API auth. PostgreSQL-backed integration tests
use a clean CI service container and the real migration. The
`0000_initial.sql` test applies only to that fresh database; it does not claim
upgrade compatibility with an earlier schema.

The required checks are:

```sh
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

### Automated Anvil + PostgreSQL payment flow

`apps/api/src/payment-flow.anvil.integration.test.ts` is a serial, opt-in
integration test run through:

```sh
pnpm --filter @giwapay/api test:anvil
```

When `RUN_ANVIL_INTEGRATION=true`, it requires a loopback
`TEST_DATABASE_URL`, `ANVIL_RPC_URL`, a reviewed local
`ANVIL_DEPLOYMENT_MANIFEST`, and ephemeral session/API-pepper/webhook/signer
test secrets. The database guard also requires `test` in the database name.
Vitest uses one worker with file parallelism disabled, and the suite takes a
PostgreSQL advisory lock before migrating/truncating the isolated database. It
then proves:

1. runtime merchant/customer identities, SIWE, merchant registration, and API
   key creation;
2. MockUSDC approval and mock-adapter exact-output payment into exact MockKRW
   settlement;
3. `ChainIndexer` confirmation, database `succeeded` projection, and verified
   `SettlementDistributed` recipient/bps/amount snapshot;
4. `payment.succeeded` delivery and HMAC verification through a real loopback
   HTTP receiver;
5. merchant-wallet-funded partial refund, canonical `Refunded` projection,
   public receipt update, and signed `refund.succeeded` delivery.

The suite skips without the explicit opt-in. If opt-in is set, missing
dependencies or variables fail the test instead of becoming mock success. It
must never target a public RPC or retained database. CI's separate
`anvil-integration` job (`Anvil payment flow integration`) creates a fresh
PostgreSQL service, starts local Anvil with chain ID `91342`, deploys the local
contracts, generates masked ephemeral test secrets, and runs this suite without
allowing a skipped opt-in.

Never convert a failing integration test into a mock success. If PostgreSQL,
Anvil, or a browser is unavailable, report that layer as unexecuted and retain
it in CI.

## Browser matrix

Playwright validates:

- landing and checkout accessibility landmarks;
- narrow mobile (`390×844`), tablet, and desktop layouts;
- no-wallet and unconfigured-token fail-closed states;
- merchant dashboard navigation and verified-state copy;
- reduced-motion behavior;
- receipt/explorer presentation from API-provided chain records.

The automated browser suite does not approve tokens or broadcast through a real
wallet. Wallet UI and responsive states are isolated there; the automated
signed chain/backend flow is exercised by the Anvil integration suite above,
while the human wallet acceptance path remains in
[local-demo.md](local-demo.md).

## Release gate

A testnet release is accepted only when:

1. dependency lockfile and git submodules are reproducible;
2. formatting, lint, strict typechecking, unit/integration/browser tests, build,
   Foundry fuzz/invariants, and static analysis pass;
3. migrations apply to an empty database;
4. `/ready` verifies database, chain ID, router/registry/fee configuration, and
   delegated signer availability;
5. deployment manifest addresses, runtime code, constructor terms, block/tx
   hashes, explorer verification, and source commit are reviewed;
6. an operator completes payment, webhook, partial refund, full refund, restart,
   and rollback drills on the target testnet.
