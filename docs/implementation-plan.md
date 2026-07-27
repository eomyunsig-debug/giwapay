# GiwaPay MVP implementation plan

This plan is intentionally short and executable. Each phase ends with focused
verification before the next phase is accepted.

1. **Foundation** — pnpm/Turborepo workspace, strict TypeScript, shared GIWA
   chain and environment configuration.
2. **Settlement contracts** — merchant and adapter registries, EIP-712 payment
   router, test assets/adapter/faucet, deployment scripts, unit/fuzz/invariant
   tests.
3. **Verified backend** — PostgreSQL schema, SIWE sessions, API keys,
   PaymentIntent API, independent chain indexer, signed webhook delivery and
   refund reconciliation.
4. **Merchant and payer experience** — dashboard, payment links, QR checkout,
   injected-wallet approval/payment, verified receipts, SDK and React package.
5. **Operations and assurance** — local Anvil demo, Docker services, CI,
   Tailscale-compatible deployment, threat model, API/runbooks and full
   repository verification.

GIWA Sepolia deployment is deliberately opt-in and is not part of the automated
local or CI path.
