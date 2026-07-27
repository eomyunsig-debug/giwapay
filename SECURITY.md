# Security policy

GiwaPay is an **unaudited testnet MVP**. Do not use it with assets of real
value. It is not production-ready and does not claim regulatory approval or an
official GIWA partnership.

## Supported scope

Security fixes target the latest `main` branch. Public-chain scripts support
GIWA Sepolia only. Mainnet deployment is intentionally absent.

## Reporting a vulnerability

Do not open a public issue containing exploit details, credentials, wallet
material, or personal data. Contact the repository owner through a private
channel and include:

- affected component and revision;
- minimum reproduction without real funds or secrets;
- impact and preconditions;
- a suggested mitigation, if known.

Never send a seed phrase or private key as part of a report.

## Operational minimums

- Use a dedicated delegated intent signer with no merchant-admin authority.
  `MerchantRegistry` rejects any signer address that equals the merchant admin,
  current payout address, or configured refund operator, including during later
  role rotations and updates.
- Store all signing/session/webhook/database secrets in a secret manager.
- Configure at least two production-grade GIWA RPC providers; the public RPC is
  rate-limited.
- Run API, indexer, and webhook worker as separate least-privilege processes.
- Keep test tokens and the fixed-rate adapter disabled outside labelled testnet
  environments.
- Monitor adapter code hashes, indexer lag, reorgs, webhook dead letters, API-key
  failures, and signer rotation.
- Require the payment indexer to verify and persist the receipt's
  `SettlementDistributed` snapshot; do not reconstruct historical payout data
  from the current registry.
- Require every PaymentIntent signature to bind the resolved recipient/bps
  snapshot through `splitHash`; registry edits must invalidate old invoices.
- Once refund calldata is issued, keep the same
  `(merchant, intentId, refundId)` pending identity. Resume may rebuild it, but
  no off-chain action can revoke already signed or broadcast calldata.
- On reorg, return affected refunds to `submitted`, invalidate undelivered
  success webhooks, and process `refund.reorged`/`payment.reorged`
  compensations before initiating replacement operations.
- Require `ADAPTER_MANAGER_ADDRESS` for public deployment. After
  `AdapterRegistry.acceptOwnership`, verify the previous owner's adapter-manager
  permission was revoked.
- Review the threat model in [`docs/threat-model.md`](docs/threat-model.md)
  before any deployment.
