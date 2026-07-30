# GiwaPay GASOK judge evidence

Status: **review pack for the submission branch — not a claim of selection,
partnership, audit, production readiness, or a completed public deployment**

This page gives a reviewer a three-minute path from the GASOK criteria to
reproducible GiwaPay evidence. The official program lists GIWA fit, originality,
feasibility, market potential, team capability, and GIWA Wallet fit; the
combined MVP phase additionally evaluates actual implementation and technical
completeness.

- Official program and criteria: <https://giwa.io/gasok>
- Public showcase: <https://giwapay-mvp.eomyunsig.chatgpt.site>
- Public source: <https://github.com/eomyunsig-debug/giwapay>
- Executable-flow demo: **`[PENDING — required before submission]`**
- Verified GIWA Explorer contract: **`[PENDING — required before submission]`**
- Public team introduction: **`[PENDING — required before submission]`**
- Technical one-pager: [gasok-one-pager.md](gasok-one-pager.md)
- Pitch deck: [pitch/GiwaPay-GASOK-Pitch-Deck.pdf](pitch/GiwaPay-GASOK-Pitch-Deck.pdf)

## Three-minute review path

1. Watch the two-minute executable-flow demo: merchant request, customer
   maximum input and fee, explicit wallet actions, `submitted`/`verifying`, and
   the canonical verified receipt. Until the pending demo URL above is replaced,
   the non-transactional showcase is context only.
2. Open the verified GIWA Explorer contract and sanitized public manifest.
   Confirm source verification, chain ID `91342`, source commit, runtime code,
   owners, fee configuration, and registry references. Until the pending
   Explorer URL above is replaced, this package must not claim a public
   deployment.
3. Open the applicant-approved public team introduction, then read the
   [pitch deck](pitch/GiwaPay-GASOK-Pitch-Deck.pdf) and
   [technical one-pager](gasok-one-pager.md) for the user problem, GIWA fit, and
   eight-week plan.
4. Inspect
   [`PaymentRouter.sol`](../packages/contracts/src/PaymentRouter.sol) and
   [`indexer-service.ts`](../apps/api/src/indexer-service.ts) for signed exact
   settlement and canonical event verification. A submitted transaction is not
   treated as payment success.
5. Open the successful CI run for the exact submitted commit. `pnpm verify`
   checks formatting, lint, types, unit and invariant tests, and production
   builds.

## Criterion-to-evidence map

| GASOK criterion        | Current evidence                                                                                                                                                        | Truth boundary                                                                                             |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| GIWA chain fit         | GIWA Sepolia chain configuration; production fail-closed settings; dedicated deploy-and-verify runbook; [Wallet host proposal](giwa-wallet-embedded-mode.md)            | Public verified deployment is pending. GIWA Wallet and mainnet interfaces are not claimed.                 |
| Originality            | Merchant-signed `splitHash`; exact-output settlement; registered-recipient enforcement; canonical receipt rather than callback-based success                            | These are implementation choices, not a claim that no other project has ever used a similar primitive.     |
| Feasibility            | Solidity, Fastify API, PostgreSQL projections, indexer, React checkout, dashboard, SDKs, Docker, CI, and local payment integration in one repository                    | Reproducible code is evidence of execution capacity; it is not an external audit.                          |
| Market potential       | [Market baseline and falsifiable pilot plan](market-opportunity.md), with planned targets of 15 interviews, three written pilot interests, and two testnet integrations | No revenue, merchant commitment, or production user is claimed today.                                      |
| Team capability        | Public repository history and the completed MVP can support the implementation claim                                                                                    | Applicant identity, role, career facts, nationality, and availability require applicant-approved evidence. |
| GIWA Wallet fit        | [Embedded checkout proposal](giwa-wallet-embedded-mode.md) defines provider, account, chain, confirmation, cancellation, and canonical-result boundaries                | It is a proposal until an official GIWA Wallet interface is available and reviewed.                        |
| Actual implementation  | Contract, API, indexer, checkout, receipt, dashboard, refund, webhook, and SDK paths are present; local integration and browser tests exist                             | The public showcase is non-transactional and does not stand in for a public contract deployment.           |
| Technical completeness | Unit, integration, invariant, browser, static-analysis, configuration, security-header, and build checks are represented in the repository and CI                       | Passing automation reduces known regressions; it does not prove the absence of vulnerabilities.            |

## Payment truth path

```text
merchant-signed PaymentIntent
  -> customer reviews exact merchant amount, maximum input, fee, and expiry
  -> explicit approval only when needed
  -> atomic router execution
  -> submitted transaction
  -> confirmation-aware indexer
  -> canonical event and distribution match
  -> verified receipt and webhook
```

The following files are the shortest evidence trail:

- [`PaymentRouter.sol`](../packages/contracts/src/PaymentRouter.sol):
  EIP-712 scope, merchant-scoped replay protection, exact collection, adapter
  validation, fee accounting, settlement distribution, refunds, and canonical
  events.
- [`MerchantRegistry.sol`](../packages/contracts/src/MerchantRegistry.sol):
  stable merchant identity, delegated signer separation, registered split
  templates, and staged administration.
- [`AdapterRegistry.sol`](../packages/contracts/src/AdapterRegistry.sol):
  allowlisted exact-output adapters, pair and input limits, code-hash checks,
  test-adapter labels, and production-mode rejection.
- [`indexer-service.ts`](../apps/api/src/indexer-service.ts):
  confirmation cursor, block-hash checks, event/distribution matching,
  projection rollback, and compensating reorg webhooks.
- [`checkout-client.tsx`](../apps/web/src/components/checkout-client.tsx):
  displayed-versus-prepared quote comparison and explicit wallet actions.
- [Architecture](architecture.md), [threat model](threat-model.md), and
  [testing guide](testing.md): system boundaries, residual risks, and
  reproducibility.

## Reproducible checks

From a clean checkout with recursive submodules and the pinned dependencies:

```sh
pnpm install --frozen-lockfile
pnpm verify
```

The repository CI additionally separates:

- workspace verification with PostgreSQL;
- Slither contract static analysis;
- a local Anvil exact-settlement payment and refund lifecycle; and
- Chromium checkout behavior.

Use the actual successful CI run for the submitted commit. Do not link an older
green run as if it tested a newer source revision.

## Public deployment gate

The application may call the deployment verified only when all rows below have
authoritative evidence:

| Evidence      | Required state                                                                                                                     |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Source commit | Clean, reviewed 40-character Git commit used for broadcast and verification                                                        |
| Network       | GIWA Sepolia chain ID `91342` and reviewed genesis block                                                                           |
| Broadcast     | Successful receipt and runtime bytecode for every submitted core contract                                                          |
| Configuration | Onchain owners, adapter manager, fee recipient, fee bps, registry references, and production mode match the reviewed values        |
| Explorer      | Source-code page reports the submitted contract as verified                                                                        |
| Public record | Sanitized manifest contains addresses, transaction hashes, code hashes, source commit, and verification status without credentials |

- GIWA Sepolia Explorer URL: **`[PENDING — mandatory before submission]`**
- Sanitized deployment manifest:
  [`deployments/giwa-sepolia/current.json`](../deployments/giwa-sepolia/current.json)
- Deployment runbook: [deployment.md](deployment.md)

`broadcast-complete`, `requested-unconfirmed`, and a transaction hash are not
equivalent to verified source code.

## Evidence still requiring the applicant

- Applicant-approved public name, role, career/project facts, and contact.
- Explicit approval of a dedicated encrypted GIWA Sepolia deployer or selection
  of an existing one.
- Testnet ETH funding through the official faucet.
- A truthful executable-flow demo recording and public video URL.
- Personal review of every consent item shown by the live form.
- Final signed-out URL check and one intentional submission.

No private key, seed phrase, password, keystore content, or raw secret should be
placed in the application, repository, recording, or chat.
