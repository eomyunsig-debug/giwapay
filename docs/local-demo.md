# Local Anvil acceptance demo

The demo is an isolated simulation that uses GIWA Sepolia's chain ID (`91342`)
without contacting or broadcasting to a public chain.

## Start

```sh
git submodule update --init --recursive
pnpm install --frozen-lockfile
pnpm demo:up
```

`demo:up` refuses to overwrite an existing `.env.demo`. Use `pnpm demo:down`
before creating a fresh environment. The generated secrets and deployment
manifest are ignored and mode `0600`.

## Wallet preparation

1. Select an injected EIP-1193 wallet dedicated to testing.
2. Add or edit a network with RPC `http://127.0.0.1:8545`, chain ID `91342`,
   native symbol `ETH`.
3. Fund its public address:

   ```sh
   ./scripts/fund-demo-wallet.sh 0xPublicAddress
   ```

The funding helper speaks only to loopback Anvil and uses its unlocked
development account. It neither asks for nor reads a private key.

## Complete merchant-to-refund flow

1. Open <http://127.0.0.1:3000/login>, connect the wallet, and sign the SIWE
   message. Confirm the wallet shows a message signature, not a transaction.
2. On onboarding, set the payout address to the merchant address and submit
   `registerMerchant` with the exact delegated signer shown by the dashboard.
3. Wait for the configured confirmation depth and click registration
   verification. The active state must come from `MerchantRegistry`.
4. Create an API key and copy its plaintext once. Refresh and confirm only its
   prefix remains.
5. Create a payment link settled in MockKRW. Use a unique idempotency key,
   positive raw amount, product description, and future expiration.
6. Open its QR/link in a second browser context or continue with another
   funded test wallet.
7. Verify merchant name, description, exact MockKRW amount, input token,
   estimated/max input, slippage, platform fee, adapter, split recipients,
   router, spender, and expiry.
8. Choose direct MockKRW, MockUSDC, or MockALT. The latter two must use the
   labelled mock exact-output adapter.
9. Approve the displayed maximum, then pay. A mined wallet transaction alone
   must show “verifying”; it must not produce success before the indexer
   confirms `PaymentSucceeded`.
10. Open the receipt and compare its transaction hash, amounts, payer, and
    explorer target with the local chain/API projection.
11. In the dashboard, request a partial refund, approve the exact MockKRW
    amount from the authorized merchant/refund-operator wallet, and send the
    refund transaction.
12. Wait for the verified `Refunded` projection and repeat with the remaining
    amount. Confirm cumulative refunds never exceed the original merchant
    settlement.
13. With a webhook receiver configured, verify `payment.succeeded` and
    `refund.succeeded` HMAC signatures and deduplicate by event ID.

The same pending `requested` or `submitted` refund can be resumed to rebuild
approval/refund transactions without changing its identity. Once executable
calldata is issued the API cannot revoke it, because a wallet may already have
signed or broadcast it. Wait for the canonical `Refunded` event before
preparing another refund.

## Negative acceptance checks

- Reuse a PaymentIntent for the same merchant: router reverts. The replay
  namespace is `(merchant, intentId)`.
- Change an idempotency key payload: API returns conflict.
- Quote an unconfigured token or disabled adapter: API fails closed.
- Rotate/revoke the delegated signer: pending signatures stop working.
- Disable the split: checkout/creation stops before payment.
- Submit an expired or payer-restricted intent from another wallet: router
  reverts.
- Stop the indexer: a mined transaction remains unverified in the backend.
- Reuse a refund ID for the same merchant PaymentIntent or exceed the remaining
  refund: router/API rejects it. The same bytes32 values under another
  `(merchant, intentId)` namespace are independent identities.

## Stop

```sh
pnpm demo:down
```

This removes only the named `giwapay-demo` containers, their disposable
PostgreSQL volume, `.env.demo`, and the local generated manifest.
