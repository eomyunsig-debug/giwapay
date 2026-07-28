# GiwaPay

> **Pay with anything. Settle exactly.**

사용자는 가진 자산으로 결제하고, 판매자는 선택한 자산과 정확한 금액으로
정산받는 GIWA 기반 비수탁 결제 레이어입니다.

GiwaPay is a testnet-only MVP implementation for non-custodial payment orchestration.
A customer approves and pays with a configured ERC-20 asset; one atomic
`PaymentRouter` transaction obtains the exact settlement output, distributes a
registry-owned merchant split, pays the fixed platform fee, and refunds unused
input. The backend accepts success only after its independent,
confirmation-aware indexer verifies the canonical router event.

Public review links:

- showcase: <https://giwapay-mvp.eomyunsig.chatgpt.site>
- source: <https://github.com/eomyunsig-debug/giwapay>

The public showcase is intentionally non-transactional. It does not imply that
GIWA Sepolia contracts or the payment backend are live.

This repository is **not audited or production-ready**, has no official GIWA
partnership, and makes no claim of fiat, gasless, regulatory, mainnet, or
production-DEX support.

## What the MVP includes

- SIWE merchant login with short-lived, single-use nonces, secure session
  cookies, origin checks, and CSRF protection
- one-time on-chain merchant registration and a delegated invoice signer whose
  address is contract-enforced to differ from the merchant admin, current
  payout address, and refund operator
- scoped API keys stored as peppered HMAC-SHA-256 digests, with plaintext
  displayed once and a non-secret prefix retained for identification
- typed, idempotent PaymentIntent REST API, hosted checkout links, and QR codes
- injected EIP-1193/EIP-6963 wallets; optional WalletConnect only when configured
- direct-token and allow-listed exact-output adapter payments
- exact merchant settlement, immutable platform-fee policy, and registered
  split templates with at most eight recipients
- independent event/receipt verification, confirmation depth, reorg rollback,
  PostgreSQL projections, and signed webhooks with retries
- full and partial merchant-funded on-chain refunds with replay-resistant
  `(merchant, intentId, refundId)` identities
- merchant dashboard, verifiable receipts, TypeScript SDK, React component, and
  example store
- local Anvil demo, opt-in GIWA Sepolia deployment, Docker, CI, Slither, and a
  Tailscale-compatible release workflow

## System boundary

```mermaid
flowchart LR
  merchant["Merchant wallet"] -->|"SIWE + registry tx"| web["Web / dashboard"]
  customer["Customer wallet"] -->|"approve + pay"| router["PaymentRouter"]
  web --> api["Fastify API"]
  api --> db["PostgreSQL"]
  api -->|"EIP-712 delegated signature"| intent["PaymentIntent"]
  intent --> router
  router --> registry["MerchantRegistry"]
  router --> adapters["AdapterRegistry + exact-output adapter"]
  router --> chain["GIWA events"]
  chain --> indexer["Indexer worker"]
  indexer --> db
  db --> worker["Webhook worker"]
  worker --> merchantServer["Merchant endpoint"]
```

There is no intermediate GiwaPay balance. Collection, optional swap,
distribution, platform fee, and unused-input refund either all complete or all
revert in the same transaction. Refunds are separately funded by the merchant
admin or its registered refund operator. Once executable refund calldata is
issued, the API cannot revoke it off-chain. A pending refund can only be resumed
with the same `(merchant, intentId, refundId)` identity until a canonical event
settles its state.

For a successful payment, the indexer verifies every canonical
`SettlementDistributed` log in the payment receipt and stores the verified
recipient/amount/basis-point distribution as the payment-time snapshot.
Receipts do not reconstruct historical settlement from mutable current
registry state. The delegated EIP-712 signature also commits to the exact
recipient/bps snapshot through `splitHash`, so a registry edit cannot redirect
an already signed invoice.

## Repository layout

```text
apps/web              Next.js hosted checkout and merchant dashboard
apps/api              HTTP server, chain indexer, and webhook worker
packages/contracts    Foundry contracts, scripts, tests, and malicious fixtures
packages/db           Drizzle schema and PostgreSQL migration
packages/chains       typed GIWA chain, RPC fallback, wallets, token registry
packages/sdk          runtime-validated TypeScript client and calldata helpers
packages/react        React provider, hooks, and checkout button
packages/ui           shared accessible UI primitives
packages/config       secure extension interfaces and runtime guards
examples/nextjs-store minimal merchant integration
docs                  API, security, deployment, testing, and operations
deployments           reviewed manifest locations; generated records are ignored
```

## Toolchain

- Node.js 24 LTS and pnpm 11
- Foundry 1.7, Solidity 0.8.28, OpenZeppelin Contracts 5.4
- PostgreSQL 18, Fastify 5, Drizzle, Next.js 16, React 19, wagmi, and viem

Dependencies are exact in `pnpm-lock.yaml`; Solidity libraries are pinned git
submodules.

## Local end-to-end demo

Prerequisites: Docker with Compose, Foundry (`forge` and `cast`), Node.js,
pnpm, and an injected browser wallet. No public-chain credential is used.

```sh
git submodule update --init --recursive
pnpm install --frozen-lockfile
pnpm demo:up
```

The command:

1. creates a private, ignored `.env.demo` with new local-only secrets;
2. starts PostgreSQL and Anvil on chain ID `91342`;
3. deploys the registries, router, three labelled mock tokens, faucet, and mock
   exact-output adapter through Anvil's unlocked account;
4. runs migrations and starts the API, indexer, webhook worker, and web app.

Open:

- web: <http://127.0.0.1:3000>
- live OpenAPI UI: <http://127.0.0.1:3001/docs>
- health: <http://127.0.0.1:3001/health>
- readiness: <http://127.0.0.1:3001/ready>

Fund only a **public address** from the local chain:

```sh
./scripts/fund-demo-wallet.sh 0xYourPublicWalletAddress
```

This grants local test ETH, MockKRW, MockUSDC, and MockALT without reading or
printing a private key. In the wallet, use RPC `http://127.0.0.1:8545` with
chain ID `91342`; if the wallet already stores GIWA Sepolia under that ID,
temporarily switch its RPC for the isolated demo. All mock assets are displayed
as “Testnet demo” and have no monetary value.

Stop the disposable demo and remove its database volume:

```sh
pnpm demo:down
```

See [local-demo.md](docs/local-demo.md) for the full acceptance walkthrough.

## Development and verification

```sh
pnpm install --frozen-lockfile
pnpm audit --prod
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Focused contract assurance:

```sh
pnpm --filter @giwapay/contracts test:ci
pnpm --filter @giwapay/contracts test:gas
```

Browser tests:

```sh
pnpm --filter @giwapay/web exec playwright install chromium
pnpm test:e2e
```

PostgreSQL-backed integration tests require `TEST_DATABASE_URL`. The dedicated
Anvil flow additionally uses `RUN_ANVIL_INTEGRATION=true`, a loopback Anvil RPC
and a local deployment manifest:

```sh
pnpm --filter @giwapay/api test:anvil
```

With its test-only environment enabled, that suite executes merchant
registration, SIWE/API-key setup, MockUSDC-to-MockKRW exact-output approval and
payment, confirmed indexer projection with settlement snapshot, signed delivery
to a real loopback HTTP webhook receiver, and a merchant-funded partial refund.
Without the explicit opt-in it is skipped; with opt-in enabled, a missing
required test variable fails closed. CI's dedicated
`Anvil payment flow integration` job provisions isolated PostgreSQL/Anvil
services, deploys the local contracts, and generates masked ephemeral test
secrets before running it. Details are in
[testing.md](docs/testing.md).

The checked-in `packages/db/migrations/0000_initial.sql` is the baseline for a
fresh database, not an in-place upgrade script for an earlier GiwaPay schema.
See [deployment.md](docs/deployment.md) before applying it outside the
disposable local/CI environments.

## API and SDK

The API is available as generated OpenAPI at `/openapi.json` and Swagger UI at
`/docs`. Mutating merchant-browser requests use the SIWE session plus
`X-CSRF-Token`; server integrations use `Authorization: Bearer gwp_test_…` and
an `Idempotency-Key` for PaymentIntents and refunds.

```ts
import { GiwaPayClient } from '@giwapay/sdk';

const giwaPay = new GiwaPayClient({
  baseUrl: process.env.GIWAPAY_API_URL!,
  apiKey: process.env.GIWAPAY_API_KEY!,
});

const result = await giwaPay.createPaymentIntent({
  idempotencyKey: crypto.randomUUID(),
  description: 'Order #1042',
  settlementToken: '0x…',
  settlementAmount: '25000000',
  expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
});

console.log(result.checkoutUrl);
```

Never put an API key in browser code. See [api.md](docs/api.md) and
[webhooks.md](docs/webhooks.md).

## GIWA Sepolia deployment

GIWA Sepolia is centralized in `@giwapay/chains`: chain ID `91342`, native ETH,
official public RPC `https://sepolia-rpc.giwa.io`, and explorer
`https://sepolia-explorer.giwa.io`. `GIWA_RPC_URL` and comma-separated fallback
providers override the public endpoint; transports use timeout, retry,
exponential delay, and ranked fallback.

Public deployment is deliberately opt-in and accepts only an existing encrypted
Foundry keystore account:

```sh
CONFIRM_GIWA_SEPOLIA_DEPLOY=91342 \
GIWAPAY_DEPLOYER_ACCOUNT=my-encrypted-foundry-account \
PLATFORM_FEE_RECIPIENT=0x… \
ADAPTER_MANAGER_ADDRESS=0x… \
pnpm deploy:giwa-sepolia
```

The wrapper checks the RPC-reported chain ID before broadcasting and never
accepts a raw private-key command argument. It does not deploy to Ethereum or
GIWA mainnet. Local and CI verification do not broadcast to GIWA Sepolia, and
this repository does not claim that a public deployment has occurred. Review
[deployment.md](docs/deployment.md) first.

## Security and scope

Start with [SECURITY.md](SECURITY.md), the
[threat model](docs/threat-model.md), and the
[security checklist](docs/security-checklist.md). Extension interfaces exist
for future payment methods, production DEXes, on/off-ramps, wallet providers,
paymasters, merchant verification, and x402. They are disabled boundaries—not
fake integrations.

Explicit non-goals include cards, Korean bank transfers, Upbit, fiat custody or
off-ramp, a production KRW stablecoin, bridges, subscriptions, chargebacks,
mainnet, and claims about unreleased GIWA Wallet or Stable Paymaster products.

## License

MIT. See [LICENSE](LICENSE).
