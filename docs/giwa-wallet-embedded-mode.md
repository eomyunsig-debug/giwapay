# GIWA Wallet embedded checkout proposal

Status: **design proposal — not implemented and not an official GIWA Wallet
integration**

GIWA's public documentation says GIWA Wallet is under development and does not
publish a Wallet SDK contract that this repository can truthfully implement.
This document defines the minimum host boundary GiwaPay needs if an official
in-app surface becomes available. The current web checkout continues to use
standard EIP-1193/EIP-6963 wallets.

Official status:
<https://docs.giwa.io/giwa-chain/en/get-started/connect-to-giwa>

## Product goal

Render a single, wallet-native confirmation surface that lets a customer:

1. recognize the merchant and signed request;
2. see the exact merchant settlement and their own maximum input;
3. approve the token only when allowance is insufficient;
4. submit the payment; and
5. distinguish transaction submission from canonical payment success.

The embedded experience may omit a separate wallet chooser and chain-switch
screen only when the host wallet has already established both context values.

## Host contract

An official host integration needs to provide an equivalent of:

```ts
interface GiwaWalletCheckoutHost {
  provider: EIP1193Provider;
  account: `0x${string}`;
  chainId: 91342;
  presentation: 'embedded';
  close(result: CheckoutResult): void;
}

type CheckoutResult =
  | { status: 'cancelled' }
  | { status: 'submitted'; transactionHash: `0x${string}` }
  | { status: 'verified'; paymentIntentId: string; receiptUrl: string }
  | { status: 'failed'; code: string };
```

This is a product contract, not an assertion about a current GIWA API. Adapt the
names to the official interface rather than asking a wallet partner to adopt
this draft.

## Entry and context validation

The host opens a normal HTTPS checkout reference containing an opaque
PaymentIntent identifier. It must not place private customer data, API keys,
signatures, seed phrases, or reusable session tokens in a URI.

Before showing the payment action, GiwaPay verifies:

- the host provider implements `request`;
- the active account exactly matches the host-provided account;
- the chain ID is `91342`;
- the PaymentIntent exists, is not expired, and is still `created`;
- the settlement token and all selectable input tokens come from the server's
  configured registry;
- the registered settlement recipients are non-empty; and
- a fresh quote is available.

If account or chain context changes, the action becomes unavailable. Embedded
mode never silently changes the network, reconnects another wallet, or submits
a transaction.

## Confirmation screen

The first viewport shows:

- merchant display name and stable onchain merchant address;
- description and expiry;
- exact token and amount the merchant receives;
- selected customer input token;
- estimated input and hard maximum input;
- platform fee;
- direct-token or reviewed adapter route;
- registered settlement recipients behind progressive disclosure; and
- a testnet/mock banner whenever any configured asset is test-only.

The wallet can independently show the transaction destination, calldata
summary, value, and requested approval. GiwaPay remains responsible for
product-level terms and canonical receipt status.

## Two explicit wallet actions

1. **Approval, only if required.** Read the current allowance and request the
   exact prepared allowance. Wait for a successful receipt before continuing.
2. **Payment.** Re-run `prepare`, compare every user-visible quote term to the
   displayed quote, and require a second click if any term changed. Then request
   the router transaction.

The current web checkout already enforces fresh prepare, quote-term comparison,
allowance reads, approval receipt, payment receipt, and independent detail
refresh. Embedded mode should reuse this execution logic rather than create a
second payment path.

## Status model

```text
review
  -> approving (optional)
  -> paying
  -> submitted
  -> verifying
  -> verified
```

- `submitted` means the wallet returned a transaction hash.
- `verifying` means the transaction receipt succeeded but the independent
  indexer has not yet confirmed the canonical GiwaPay event.
- `verified` is the only successful payment outcome.
- A timeout remains pending or failed; it never becomes success optimistically.
- A detected reorganization moves projected state back according to the
  existing indexer rules.

## Host and GiwaPay responsibilities

| Host wallet                                              | GiwaPay                                                               |
| -------------------------------------------------------- | --------------------------------------------------------------------- |
| Own account consent and provider lifecycle               | Fetch and validate PaymentIntent                                      |
| Confirm actual approval/payment requests                 | Produce fresh quote and prepared calldata                             |
| Display chain, destination, value, and signature prompts | Display merchant terms, maximum input, fee, route, recipients, expiry |
| Return transaction result or user cancellation           | Verify canonical events and produce receipt                           |
| Prevent background or unapproved signing                 | Never handle seed phrases or private keys                             |

## Privacy and security rules

- Do not auto-request accounts on page load.
- Do not send a customer address to analytics before wallet consent.
- Do not log full addresses, calldata, signatures, or raw provider errors.
- Do not accept transaction calldata supplied by a URI or host message.
- Bind host messages to the expected origin and frame/window source if an
  iframe or webview bridge is used.
- Reject stale quotes and changed recipients, fees, adapters, routers, or
  approval spenders.
- Keep an explicit close/cancel path before every wallet request.
- Preserve the public testnet, mock-asset, and unaudited labels.

## Implementation slices

1. Extract the current checkout execution into a shared state machine with
   web-mode regression tests.
2. Add a typed host adapter that wraps only an official provider and close
   callback.
3. Add an embedded presentation that omits wallet selection only after host
   context validation.
4. Add tests for account change, wrong chain, host origin, changed quote,
   approval cancellation, payment cancellation, submitted-but-unverified, and
   reorg rollback.
5. Run the desktop/mobile/tablet browser matrix and a host-wallet sandbox.
6. Integrate a GIWA-specific SDK or deep link only after the GIWA team publishes
   and reviews the interface.

## Acceptance criteria

- No wallet chooser or chain-switch prompt appears when valid host context is
  supplied.
- Missing, changed, or mismatched host context fails closed.
- The merchant, exact settlement, maximum input, fee, expiry, and testnet state
  are visible before approval.
- Approval and payment remain separate explicit requests.
- The UI never reports success before a canonical indexed event.
- The host receives a verified result only after the receipt URL exists.
- Standard web checkout behavior is unchanged.
