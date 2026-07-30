# GiwaPay technical one-pager

## Pay with anything. Settle exactly.

GiwaPay is a non-custodial GIWA payment layer. A customer pays with a supported
asset; the merchant receives the token and exact amount fixed in a signed
payment request. Payment success comes from canonical chain evidence, not a
browser callback or a submitted transaction hash.

- Public showcase: <https://giwapay-mvp.eomyunsig.chatgpt.site>
- Public source: <https://github.com/eomyunsig-debug/giwapay>
- Target network: **GIWA Sepolia, chain ID 91342**
- GASOK track: **Mass Adoption**

## The merchant and customer flow

1. The merchant creates an EIP-712 `PaymentIntent` containing the settlement
   token, exact amount, registered recipients, fee rule, expiry, and
   `splitHash`.
2. The customer opens a payment link, sees the merchant amount, input estimate,
   maximum input, fee, expiry, and testnet status.
3. The customer explicitly approves a token only when needed, then sends the
   payment transaction from their own wallet.
4. The router either completes payment, optional allowed routing, platform fee,
   split settlement, and unused-input refund atomically—or reverts everything.
5. The indexer waits for canonical evidence, checks the expected event and
   distribution, and only then emits a verified receipt and webhook.

GiwaPay never holds a merchant or customer balance.

## Architecture

```text
Merchant dashboard
  -> PaymentIntent API and non-exportable merchant signer
  -> Customer checkout and explicit wallet actions
  -> PaymentRouter on GIWA
       -> direct settlement-token path
       -> allowlisted exact-output adapter, when production liquidity exists
       -> registered split recipients
  -> confirmation-aware canonical indexer
  -> verified receipt, webhook, refund, and reconciliation surfaces
```

The monorepo contains:

- Solidity registries and `PaymentRouter`;
- Fastify API and PostgreSQL projections;
- confirmation-aware indexer with reorg rollback;
- webhook and retention workers;
- React checkout and merchant dashboard;
- TypeScript client and server SDKs;
- Docker, local Anvil integration, browser tests, Slither, and CI.

## Security and truth boundaries

| Boundary     | Behavior                                                                                             |
| ------------ | ---------------------------------------------------------------------------------------------------- |
| Signed scope | Settlement token, exact amount, expiry, recipients, fee, and split snapshot are bound before payment |
| Custody      | Customer calls the router; GiwaPay does not retain pooled balances                                   |
| Routing      | Only allowlisted adapters; exact balance deltas and maximum input are checked                        |
| Success      | `submitted` and `verifying` are not success; canonical event and distribution checks are required    |
| Reorgs       | Indexed projections can roll back before a new canonical state is accepted                           |
| Admin        | Sensitive changes use staged rotation and explicit production configuration                          |
| Secrets      | Merchant signing keys are separated from application data and are not exposed to the browser         |

An automated test suite is not an external security audit.

## Why GIWA

GIWA combines an EVM execution environment with a future self-custody Wallet
surface and ecosystem primitives such as Dojang and `up.id`. GiwaPay turns
those primitives into a concrete merchant workflow:

- a Wallet-native payment surface can receive an approved provider, account,
  and chain context without repeating connection screens;
- Flashblocks may improve the perceived submission stage, but canonical
  confirmation remains the settlement truth;
- Dojang and `up.id` can become separate merchant-identity signals without
  changing payment execution or implying endorsement; and
- the direct-token path works before a production DEX, stablecoin paymaster, or
  fiat integration exists.

The Wallet host mode is a proposal until GIWA provides an official interface.

## Current evidence and pending hard gate

**Implemented and reproducible**

- GIWA Sepolia network configuration and production fail-closed checks;
- direct-token payment path and a clearly labelled test-only fixed-rate adapter;
- EOA and ERC-1271 merchant authorization;
- exact settlement, fee, split, refund, receipt, and webhook logic;
- local end-to-end payment lifecycle and CI.

**Required before GASOK submission**

- broadcast the production-mode contracts to GIWA Sepolia;
- verify at least one submitted contract in GIWA Explorer;
- record the deployed addresses and source commit in a public manifest; and
- demonstrate the verified Explorer link without exposing wallet secrets.

**Not claimed**

- GIWA mainnet or official GIWA Wallet SDK integration;
- Upbit account, exchange, or listing integration;
- fiat custody or off-ramp;
- production KRW stablecoin, paymaster, DEX, or audited liquidity;
- merchant commitments, revenue, or production users.

## Phase 3 outcomes

Within eight weeks:

1. validate the problem with 15 merchant interviews and three written pilot
   interests;
2. agree on an official Wallet host boundary with the GIWA team;
3. complete two direct-token testnet merchant integrations;
4. run at least 20 disposable test payments per pilot;
5. measure setup time, checkout completion, canonical receipt success and
   latency, and classified failure reasons; and
6. complete external contract review and a mainnet-readiness rehearsal before
   any production broadcast.

The pilot targets are future validation gates, not current traction.

## Official references

- GASOK: <https://giwa.io/gasok>
- GIWA connection and network information:
  <https://docs.giwa.io/giwa-chain/en/get-started/connect-to-giwa>
- GIWA transaction fees and future paymaster status:
  <https://docs.giwa.io/giwa-chain/en/network-information/transaction-fees>
- GIWA testnet terms:
  <https://docs.giwa.io/giwa-chain/en/terms-and-policies/testnet-terms-of-use>
