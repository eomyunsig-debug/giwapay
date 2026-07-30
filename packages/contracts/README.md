# GiwaPay contracts

Non-upgradeable Solidity contracts for exact-asset, exact-amount settlement on
GIWA. The router is non-custodial by construction: collection, optional swap,
split distribution, fee distribution, and unused-input refund all occur in one
transaction. A revert rolls back the entire flow.

These contracts have not been independently audited and are not represented as
production-ready.

## Components

- `MerchantRegistry`: self-service merchant registration, payout address,
  narrow delegated invoice signer, refund operator, pause state, and immutable
  split templates. The delegated signer is address-separated on-chain from the
  merchant admin, current payout address, and refund operator across
  registration and every later role update.
- `AdapterRegistry`: two-step-owned allow-list with adapter managers, emergency
  pause, runtime bytecode hashes, token pairs, input caps, and production/test
  separation.
- `PaymentRouter`: EIP-712 intent verification, replay protection, direct-token
  and exact-output settlement, exact platform fee policy, splits, and
  idempotent merchant-funded refunds.
- `MockKRW`, `MockUSDC`, and `MockALT`: explicitly labelled demo tokens. They
  are not official assets and have no redemption promise.
- `MockTokenFaucet`: rate-limited test-token minting.
- `MockFixedRateExactOutputAdapter`: deterministic, inventory-funded demo
  adapter. It is not a DEX.

There are no proxies, upgrade hooks, `delegatecall`s, or user-selected arbitrary
external targets in `PaymentRouter`.

## Reproducible toolchain

- Solidity: `0.8.28`
- OpenZeppelin Contracts: `v5.4.0`, pinned git submodule
- forge-std: `v1.9.7`, pinned git submodule

From a fresh checkout:

```sh
git submodule update --init --recursive
cd packages/contracts
forge fmt --check
forge build --sizes
forge test
```

CI uses the stronger `ci` Foundry profile with 2,000 fuzz cases and 256
invariant runs.

## PaymentIntent

EIP-712 domain:

```text
name: GiwaPay
version: 1
chainId: current chain ID
verifyingContract: deployed PaymentRouter
```

Exact struct type:

```text
PaymentIntent(
  bytes32 intentId,
  address merchant,
  address signer,
  address settlementToken,
  uint256 settlementAmount,
  bytes32 splitId,
  bytes32 splitHash,
  uint256 platformFee,
  uint48 validAfter,
  uint48 expiresAt,
  address payer,
  bytes32 metadataHash
)
```

`intentId` is single-use within the merchant namespace: replay state and
payment records are keyed by `(merchant, intentId)`. `payer` may be zero to
allow any payer, otherwise it must equal the transaction sender. The signed
`signer` must be the current delegated signer in `MerchantRegistry`.
`SignatureChecker` validates either an EOA signature or an ERC-1271
contract-wallet signature at execution time, so signer rotation/revocation
invalidates pending signatures.

The platform fee is not discretionary invoice data. It must equal:

```text
ceil(settlementAmount * PaymentRouter.platformFeeBps() / 10_000)
```

The recipient and bps are resolved only from the registered `splitId`. The
router compares them with signed
`splitHash = keccak256(abi.encode(recipients, basisPoints))`. A delegated
signer cannot inject recipients, and an admin split edit invalidates already
signed invoices instead of redirecting them.

Dashboards can enumerate stable custom IDs with `splitTemplateCount(merchant)`
and `splitTemplateIdAt(merchant, index)`, then load each template through
`getSplitTemplate`. Disabled historical IDs remain enumerable for auditability;
the default zero ID is queried directly and is not part of the custom list.

## Payment routes

Call:

```solidity
pay(PaymentIntent intent, bytes signature, PaymentParams params)
```

Direct-token route:

```text
params.tokenIn      = intent.settlementToken
params.maxAmountIn  >= intent.settlementAmount + intent.platformFee
params.adapter      = address(0)
params.adapterData  = empty bytes
```

Exact-output adapter route:

```text
params.tokenIn      = selected supported input token
params.maxAmountIn  = payer-approved slippage ceiling
params.adapter      = enabled AdapterRegistry entry
params.adapterData  = adapter-specific validated data
```

The router pulls `maxAmountIn`, grants the adapter only that allowance, checks
the measured input consumption and exact output balance delta, resets allowance
to zero, and refunds unused input in the same transaction.

All inbound and outbound balance deltas are measured. Fee-on-transfer,
rebasing, or otherwise non-standard tokens that cannot deliver exact amounts
are unsupported and fail closed.

Canonical success event:

```solidity
event PaymentSucceeded(
    bytes32 indexed intentId,
    address indexed merchant,
    address indexed payer,
    address tokenIn,
    address settlementToken,
    uint256 amountIn,
    uint256 merchantAmount,
    uint256 platformFee,
    bytes32 splitId,
    address adapter
);
```

Each resolved merchant split recipient also produces:

```solidity
event SettlementDistributed(
    bytes32 indexed intentId,
    address indexed merchant,
    address indexed recipient,
    address settlementToken,
    uint256 amount,
    uint16 basisPoints
);
```

One event is emitted for every registered recipient, including a recipient
whose actual amount rounds to zero. Receipts and indexers must treat these logs
as the canonical payment-time distribution snapshot. They must not reconstruct
historical recipients from the current default payout or current registry
state, which may change after settlement. `PaymentSucceeded` remains unchanged
and summarizes the aggregate merchant amount.

## Refunds

The merchant admin or registered refund operator calls:

```solidity
refund(address merchant, bytes32 intentId, bytes32 refundId, uint256 amount)
```

The caller supplies settlement tokens with `transferFrom`; GiwaPay never draws
from previously settled recipients. `refundId` is nonzero and single-use
within its merchant PaymentIntent; the replay-protection key is
`(merchant, intentId, refundId)`. Reusing the same bytes32 values in another
merchant or PaymentIntent namespace therefore cannot consume that payment's
refund identity. Total refunds cannot exceed the original merchant settlement
amount. Platform fees are not silently clawed back.

Canonical refund event:

```solidity
event Refunded(
    bytes32 indexed intentId,
    bytes32 indexed refundId,
    address indexed merchant,
    address payer,
    address settlementToken,
    uint256 amount,
    uint256 totalRefunded,
    address operator
);
```

Refunds remain callable during a router emergency pause.

## Adapter security boundary

Before every adapter call the registry verifies:

- registry and adapter are enabled;
- runtime `extcodehash` still equals the pinned hash;
- test-only adapters are absent from production-mode registries;
- the exact token pair is enabled;
- `maxAmountIn` does not exceed the input-token cap.

Anyone can persistently disable changed bytecode with
`disableChangedAdapter`. Proxy adapters are intentionally unsupported: a
proxy's runtime hash does not attest to its implementation. Register a new
non-proxy adapter version and retire the old address instead.

## Local simulated GIWA Sepolia

The local workflow uses GIWA Sepolia's chain ID so the API, wallet, signatures,
and Anvil all agree. It never reaches a public chain.

Terminal 1:

```sh
anvil --chain-id 91342
```

Terminal 2, using Anvil's first unlocked public account address:

```sh
export GIWAPAY_LOCAL_SENDER=0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266
DEPLOYER_ADDRESS="$GIWAPAY_LOCAL_SENDER" \
  forge script script/DeployLocal.s.sol:DeployLocal \
  --rpc-url http://127.0.0.1:8545 \
  --sender "$GIWAPAY_LOCAL_SENDER" \
  --unlocked \
  --broadcast
```

No private key is read by the script. Deployed mock contracts and adapter are
always test-labelled.

## Opt-in GIWA Sepolia deployment

`DeployGiwaSepolia` hard-fails unless `block.chainid == 91342`. It defaults to a
production-mode adapter registry and does not deploy mocks. The RPC remains
configurable; the official public endpoint may be rate-limited.

Use only an already-configured Foundry keystore account, and review every
environment value before adding the explicit `--broadcast` flag:

```sh
export GIWA_RPC_URL=https://sepolia-rpc.giwa.io
export DEPLOYER_ADDRESS=0x...
export PLATFORM_FEE_RECIPIENT=0x...
export ADAPTER_MANAGER_ADDRESS=0x...
export PLATFORM_FEE_BPS=50
export PRODUCTION_MODE=true

forge script script/DeployGiwaSepolia.s.sol:DeployGiwaSepolia \
  --rpc-url "$GIWA_RPC_URL" \
  --account "$FOUNDRY_ACCOUNT" \
  --sender "$DEPLOYER_ADDRESS" \
  --broadcast
```

The script never deploys to GIWA or Ethereum mainnet and never reads a raw
private key. To deploy demo mocks on GIWA Sepolia, explicitly set
`PRODUCTION_MODE=false` and `DEPLOY_TEST_MOCKS=true`; those addresses must
remain labelled testnet demo throughout the UI and API.

## Test coverage

The suite includes:

- registration, role separation, signer rotation/revocation, pause, and split
  validation;
- adapter EOA rejection, production test-adapter rejection, pair/cap checks,
  runtime-code mutation, pause, and two-step ownership;
- direct and exact-output payments, input refund, allowance reset, fee policy,
  payer binding, replay, expiry, split rounding, partial/full refunds, and
  `(merchant, intentId, refundId)` idempotency;
- canonical per-recipient distribution logs, zero-amount rounding entries, and
  historical receipt integrity after a default payout change;
- fee-on-transfer, short-output, lying-accounting, and reentrant malicious
  contracts;
- fuzzed payment amounts and split bps;
- handler-based invariants for zero router balances, accounting conservation,
  refund caps, and replay rejection.

## Static-analysis triage

CI runs Slither `0.11.4`. Two generic detectors are explicitly triaged in
`slither.config.json`:

- `calls-loop`: settlement performs balance-checked ERC-20 transfers inside a
  merchant split loop. The registry caps the loop at eight unique recipients,
  the router is non-reentrant, and removing the calls would remove the exact
  receipt guarantee.
- `timestamp`: intent validity and faucet cooldown deliberately use timestamps.
  Short miner/validator timestamp variance cannot redirect funds or bypass a
  signature, and is acceptable for invoice expiry and a test-token cooldown.

All other enabled medium/high/low findings remain CI-failing.
