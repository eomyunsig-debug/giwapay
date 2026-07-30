# MVP assumptions

These assumptions make the implementation deterministic without inventing
unreleased GIWA products or production integrations.

## Network and wallets

- The only public target is **GIWA Sepolia**, chain ID `91342`, native currency
  `ETH`, explorer `https://sepolia-explorer.giwa.io`.
- `GIWA_RPC_URL` overrides the official public endpoint. Comma-separated
  `GIWA_RPC_FALLBACK_URLS` provide additional read providers. The official RPC
  is rate-limited and is not treated as a production SLA.
- Browser connections use standard EIP-1193/EIP-6963 injected providers.
  WalletConnect is constructed only when
  `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` exists.
- GIWA Wallet and GIWA Stable Paymaster are future products. No SDK, gasless
  behavior, or official availability is assumed. Gas sponsorship is disabled
  by default behind an interface.

## Assets and routing

- The demonstrator uses only clearly labelled `MockKRW`, `MockUSDC`, and
  `MockALT` ERC-20 contracts. No address is represented as an official GIWA or
  KRW stablecoin.
- Native-ETH checkout is out of scope for the MVP payment path. ETH is used only
  for transaction gas.
- A direct payment uses the settlement token as the input token.
- A routed payment uses an allowlisted exact-output adapter. The repository
  contains only a fixed-rate, test-only adapter. Production DEX routing is an
  extension point and is not faked.
- The exact merchant amount is distributed according to the registered split.
  The platform fee is an additional settlement-token amount, so it never
  reduces merchant settlement.
- Fee-on-transfer, rebasing, ERC-777-like callback tokens, proxy adapters, and
  tokens whose transfers do not preserve exact balance deltas are unsupported.

## Intent, finality, and refunds

- A PaymentIntent is an EIP-712 payload signed by the merchant's currently
  delegated signer. The signed signer address may be an EOA or ERC-1271
  contract wallet. Settlement recipients are not signer-controlled: only a
  registered split ID may be referenced, and the signature fixes its resolved
  recipient/bps snapshot through
  `splitHash = keccak256(abi.encode(recipients, basisPoints))`.
- `MerchantRegistry` rejects a delegated signer address that equals the
  merchant admin, current payout address, or configured refund operator at
  registration and on subsequent role updates. The admin, payout address, and
  refund operator are not otherwise required to be mutually distinct.
- Client transaction submission never marks success. The indexer marks a
  payment successful only after it observes the canonical router events at the
  configured confirmation depth. It validates the aggregate
  `PaymentSucceeded` event and every `SettlementDistributed` entry, then stores
  the recipient, amount, and basis points as the immutable payment-time
  settlement snapshot.
- GIWA Sepolia's local/demo confirmation depth defaults to three and is
  configurable. The indexer stores block hashes and rolls now-noncanonical
  projections back on a detected reorganization.
- Refunds are separate merchant-funded on-chain transfers through the router.
  They may be partial, cannot exceed the paid amount cumulatively, and are
  accepted only from the merchant admin or configured refund operator.
- Payment replay protection is scoped by `(merchant, intentId)`, and refund
  replay protection by `(merchant, intentId, refundId)`, not by either bytes32
  value globally. Once executable refund calldata is issued, `requested` or
  `submitted` remains pending under the same identity and can only be resumed.
  Only an indexed canonical `Refunded` event marks it successful. A reorg
  returns it to `submitted` and emits a compensating `refund.reorged`.

## Identity, keys, and operations

- The merchant admin authenticates with SIWE. Nonces are short-lived,
  single-use, and stored in PostgreSQL. Sessions use opaque, server-hashed,
  HTTP-only cookies plus origin checks and a CSRF token for
  cookie-authenticated mutations.
- SIWE verifies ordinary EOA signatures first and falls back to an on-chain
  ERC-1271 check for contract-wallet merchant admins.
- API keys and session identifiers are stored as peppered HMAC-SHA-256 digests.
  API-key authentication hashes the complete presented key and performs an
  indexed digest lookup; the prefix is retained only for display. A newly
  created API key or webhook signing secret is shown once.
- Production delegated PaymentIntent signing uses a distinct non-exportable
  AWS KMS secp256k1 key handle per merchant. PostgreSQL stores only the KMS key
  identifier and derived public Ethereum address, never private key material.
  Production defaults to this DB-backed mapping; the bounded environment JSON
  source remains an explicit local/legacy compatibility mode. A shared
  extractable signer remains available only for local/testnet demo operation
  and production rejects it. Rotation/revocation remains an on-chain
  merchant-admin action.
- One PostgreSQL database is sufficient for jobs. Workers claim rows with
  locking and leases; Redis is intentionally not required. A separately
  supervised retention worker prunes expired auth/session state, terminal old
  webhooks, chain blocks outside the configured reorg safety window, and
  expired distributed public-route limit buckets.
- Local development uses Anvil's deterministic unlocked accounts without
  copying their keys into the repository. Those accounts are local-only and
  are never accepted by production configuration.
- Absence of Tailscale, Docker, a public DNS name, a GIWA-funded deployer, or a
  production RPC does not block local implementation and verification against
  isolated PostgreSQL and Anvil services.

## Product and legal boundary

- The software is an unaudited MVP, not a claim of GIWA partnership,
  production readiness, regulatory approval, fiat custody, bank/card support,
  tax reporting, or chargeback handling.
- Dojang/Verified Address, on/off ramps, x402, production DEXes, GIWA Wallet,
  and a stable paymaster are typed extension interfaces only.
