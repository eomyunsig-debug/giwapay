# GiwaPay API

Fastify API, confirmed-chain indexer, and signed-webhook worker for the GiwaPay
GIWA Sepolia MVP.

## Trust boundary

- A browser-reported transaction result never marks a payment or refund as
  successful.
- The indexer waits for `CHAIN_CONFIRMATIONS`, verifies the receipt and exact
  canonical logs, compares `PaymentSucceeded` to the stored EIP-712 intent,
  validates every `SettlementDistributed` recipient, amount, and basis-point
  entry, and only then updates PostgreSQL with the payment-time distribution
  snapshot.
- Each EIP-712 intent signs `splitHash = keccak256(abi.encode(recipients,
basisPoints))`. Changing a registered split after invoice creation therefore
  invalidates the pending intent instead of silently redirecting settlement.
- Merchant registration is synchronized from a confirmed
  `MerchantRegistry.getMerchant` read. A submitted transaction hash is not
  accepted as proof of registration.
- PaymentIntent signatures are created by the configured delegated signer.
  Production uses a distinct non-exportable AWS KMS key per merchant; local
  demo keys are never returned or logged.
- API keys, SIWE nonces, sessions, and CSRF tokens are stored as peppered
  HMAC-SHA-256 digests. API-key authentication computes the complete presented
  key's digest and performs an indexed lookup; the retained prefix is display
  metadata only. Webhook secrets are AES-256-GCM encrypted at rest and returned
  once.

## Processes

```bash
pnpm --filter @giwapay/db db:migrate
pnpm --filter @giwapay/api dev:server
pnpm --filter @giwapay/api dev:indexer
pnpm --filter @giwapay/api dev:webhooks
pnpm --filter @giwapay/api dev:retention
```

Run all four processes separately in production. The indexer and retention
worker use distinct PostgreSQL advisory locks, so only one active instance of
each advances its work. Webhook
workers use row locks with `SKIP LOCKED` and may be scaled horizontally.

## Authentication

1. `POST /v1/auth/nonce` with `{ "address": "0x..." }` from an allowed Origin.
2. Build an EIP-4361 message from the returned domain, URI, chain ID, nonce, and
   expiration, then sign it with the merchant wallet.
3. `POST /v1/auth/verify` with the exact message and signature.
4. Browser mutations require the secure HTTP-only session cookie plus the
   returned `x-csrf-token`. Production cookies use `Secure`.
5. Server-to-server calls use `Authorization: Bearer gwp_test_...` and explicit
   scopes.

Nonces expire quickly and are consumed atomically. SIWE domain, URI, wallet,
origin, chain ID, issue/expiration time, and signature are verified. Signature
verification supports both EOAs and ERC-1271 contract wallets.

## Main routes

- `GET /health`, `GET /ready`
- `GET /openapi.json`, `/docs` when `EXPOSE_API_DOCS=true`
- `GET/PATCH /v1/merchants/me`
- `POST /v1/merchants/me/registration/verify`
- `GET/POST /v1/api-keys`, `DELETE /v1/api-keys/:id`
- `GET/POST /v1/payment-intents`
- `GET /v1/payment-methods`
- `GET /v1/payment-intents/:id`
- `GET /v1/payment-intents/:id/quote`
- `POST /v1/payment-intents/:id/prepare`
- `POST /v1/payment-intents/:id/refunds`
- `POST /v1/payment-intents/:id/refunds/:refundId/resume`
- `GET/POST/DELETE /v1/webhook-endpoints`
- `GET /v1/webhook-deliveries`

`prepare` returns ERC-20 approval and router calldata. Sending those
transactions does not change the API state; the customer must poll the public
PaymentIntent until the confirmed indexer projection changes.

Every create/refund request has an idempotency key. Reusing it with different
parameters returns `409 idempotency_key_conflict`.

Once executable refund calldata has been issued, that identity is irrevocable
at the API layer: a signed or broadcast wallet transaction may still execute.
`requested` and `submitted` are both pending states, and resume always rebuilds
transactions for the same `(merchant, intentId, refundId)` identity.
Only a confirmed canonical `Refunded` event marks it `succeeded`. A reorg moves
an affected refund back to `submitted`, invalidates pending success deliveries
to `dead_letter`, and emits `refund.reorged`; a removed payment similarly emits
`payment.reorged`.

API key secrets are intentionally not stored in recoverable form. Retrying an
API-key creation with the same idempotency key returns
`409 api_key_secret_already_issued`; use a new idempotency key to create and
display a replacement secret.

## Webhook verification

Each request has:

- `giwapay-event-id`: stable delivery event ID
- `idempotency-key`: the same event ID
- `giwapay-signature`: `t=<unix-seconds>,v1=<hex-hmac>`

The HMAC input is `<timestamp>.<raw-request-body>`. Consumers should reject
stale timestamps, calculate HMAC-SHA256 with their endpoint secret, use a
constant-time comparison, and deduplicate the event ID. Non-2xx responses are
retried with exponential backoff and jitter; exhausted deliveries move to
`dead_letter`.

Production endpoint creation requires HTTPS and rejects URLs resolving to
private/reserved addresses. A network egress policy should additionally limit
the webhook worker to public TCP 443.

## Tests

```bash
pnpm --filter @giwapay/api typecheck
pnpm --filter @giwapay/api test
pnpm --filter @giwapay/db test
```

The SIWE/PostgreSQL integration suite runs only when `TEST_DATABASE_URL` points
to an isolated test database:

```bash
TEST_DATABASE_URL=postgresql://... pnpm --filter @giwapay/api test
```

The automated chain flow has a separate serial Vitest configuration:

```bash
RUN_ANVIL_INTEGRATION=true \
TEST_DATABASE_URL=postgresql://... \
ANVIL_RPC_URL=http://127.0.0.1:... \
ANVIL_DEPLOYMENT_MANIFEST=/absolute/path/to/local-manifest.json \
pnpm --filter @giwapay/api test:anvil
```

It uses runtime-only merchant/customer accounts and test secrets against local
chain ID `91342`. It verifies on-chain registration, SIWE and API-key setup,
MockUSDC-to-MockKRW exact-output approval/payment, `ChainIndexer` success plus
the `SettlementDistributed` snapshot, signed delivery to a real loopback HTTP
receiver, and a merchant-funded partial refund through its database, receipt,
and webhook. The test skips unless `RUN_ANVIL_INTEGRATION=true`; after opt-in,
missing required variables are an error. Never point it at public GIWA Sepolia
or a retained database. CI runs it in the dedicated
`Anvil payment flow integration` job after deploying the contracts to a fresh
local chain.

Both database suites start from `migrations/0000_initial.sql` on a fresh
isolated database. That file is not an in-place upgrade for an older schema.

The official public GIWA RPC may be rate-limited. Set `GIWA_RPC_URL` to a
dedicated provider and configure independent `GIWA_RPC_FALLBACK_URLS` for
production-like environments. Set `CHAIN_EXPLORER_URL` to an empty string for
local Anvil so receipts and webhooks return `explorerUrl: null` instead of a
misleading public-explorer link.

`NODE_ENV=production` enables runtime hardening and secure cookies; it does not
make test contracts production assets. Local or GIWA testnet mock deployments
must additionally opt in with `ALLOW_TEST_CONTRACTS=true`. Keep it false for
all customer/production contract deployments.

When running behind a reverse proxy, set `TRUSTED_PROXY_CIDRS` to only the exact
proxy IPs or bounded CIDRs (for example `127.0.0.1,100.64.0.0/10`). The default
is `false`, and catch-all `/0` ranges are rejected so forwarded client IPs
cannot be spoofed into the rate limiter.
