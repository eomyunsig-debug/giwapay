# GiwaPay REST API

Runtime OpenAPI is generated from route schemas:

- JSON: `GET /openapi.json`
- interactive UI: `GET /docs`

The API always uses raw integer token units as base-10 strings. Integrators must
obtain token decimals from the deployment's verified token registry and must
not use JavaScript floating-point numbers for amounts.

## Authentication

Merchant browser:

1. `POST /v1/auth/nonce` with a wallet address and an allowed `Origin`.
2. Build EIP-4361 using the exact returned domain, URI, chain ID, nonce,
   statement, issued time, and expiration.
3. `POST /v1/auth/verify` with the message and signature.
4. Keep the HTTP-only session cookie; send `X-CSRF-Token` on mutations.
5. `POST /v1/auth/logout` to revoke the session.

Merchant server:

```http
Authorization: Bearer gwp_test_…
```

Keys are scope-checked and revocable. The server computes a peppered
HMAC-SHA-256 digest of the presented complete key and performs an indexed
digest lookup; plaintext is returned once and never stored. The retained
prefix is display metadata only, not an authentication lookup or comparison.
Do not send keys to a browser or commit them.

## Merchant and API keys

| Method   | Path                                   | Purpose                              |
| -------- | -------------------------------------- | ------------------------------------ |
| `GET`    | `/v1/merchants/me`                     | current merchant and required signer |
| `PATCH`  | `/v1/merchants/me`                     | display settings                     |
| `POST`   | `/v1/merchants/me/registration/verify` | confirmed registry sync              |
| `GET`    | `/v1/api-keys`                         | key metadata                         |
| `POST`   | `/v1/api-keys`                         | one-time plaintext key creation      |
| `DELETE` | `/v1/api-keys/:id`                     | revoke key                           |

On-chain registration is performed by the connected wallet; the API never
pretends a client transaction succeeded. Verification reads confirmed
`MerchantRegistry` state.

## PaymentIntents

Create:

```http
POST /v1/payment-intents
Authorization: Bearer …
Idempotency-Key: 137a47c4-4b74-4acc-aad4-1e0796ebef44
Content-Type: application/json

{
  "idempotencyKey": "137a47c4-4b74-4acc-aad4-1e0796ebef44",
  "description": "Order #1042",
  "settlementToken": "0x…",
  "settlementAmount": "25000000",
  "splitId": "0x0000000000000000000000000000000000000000000000000000000000000000",
  "expiresAt": "2026-07-28T12:30:00.000Z",
  "metadata": {
    "merchantOrderId": "1042"
  }
}
```

The response contains the typed PaymentIntent, signature, checkout URL, QR
data URL, registered settlement recipients, and `idempotentReplay`. Reusing
the key with different semantics returns `409`. The typed intent includes
`splitHash = keccak256(abi.encode(recipients, basisPoints))`, fixing the
recipient/bps snapshot at signing time. If the registered split changes before
execution, the router rejects the old intent. After a verified payment, the
response adds the immutable amount snapshot derived from the canonical
`SettlementDistributed` logs in that transaction receipt.

| Method | Path                                               | Authentication              |
| ------ | -------------------------------------------------- | --------------------------- |
| `GET`  | `/v1/payment-intents`                              | scoped session/API key      |
| `POST` | `/v1/payment-intents`                              | `payment_intents:write`     |
| `GET`  | `/v1/payment-intents/:id`                          | public checkout/receipt     |
| `GET`  | `/v1/payment-intents/:id/quote`                    | public live on-chain quote  |
| `POST` | `/v1/payment-intents/:id/prepare`                  | public calldata preparation |
| `POST` | `/v1/payment-intents/:id/refunds`                  | `refunds:write`             |
| `POST` | `/v1/payment-intents/:id/refunds/:refundId/resume` | `refunds:write`             |

`quote` returns exact merchant output, platform fee, estimated and maximum
input, slippage, adapter identifier/address, router/spender, and a short
expiration. `prepare` re-quotes and returns ERC-20 approval plus router
calldata. The wallet remains the only transaction signer.

Statuses:

- `created`: signed but no verified canonical payment event
- `succeeded`: confirmed `PaymentSucceeded` verified against stored terms
- `partially_refunded`: confirmed cumulative refund is below settlement
- `refunded`: confirmed cumulative refund equals settlement
- `expired`: never paid and past the signed expiry

The backend does not accept a browser-submitted transaction hash as success.
Payment replay is namespaced by `(merchant, intentId)`, so two merchants may
use the same bytes32 `intentId` without consuming one another's identity.

## Refunds

`POST /v1/payment-intents/:id/refunds` takes positive `amount`, optional
`reason`, and matching body/header idempotency key. It returns:

- an exact settlement-token approval transaction;
- `PaymentRouter.refund(merchant, intentId, refundId, amount)` calldata;
- the stable refund record.

Only the registry's merchant admin or refund operator can execute it. The
merchant wallet funds the transfer. The indexer updates status only after
verifying the canonical `Refunded` event.

The on-chain replay key is `(merchant, intentId, refundId)`: a refund ID is
single-use for one merchant PaymentIntent, while another merchant or intent
may use the same bytes32 value without consuming that identity. The database
projects the same merchant-owned PaymentIntent/refund relationship.

Refund preparation-record statuses are:

- `requested`: calldata was prepared but no authoritative on-chain refund has
  been indexed;
- `submitted`: the identity may already have been broadcast or was restored
  after a reorg, but no canonical refund currently proves success;
- `succeeded`: a canonical `Refunded` event was independently verified.

`POST .../:refundId/resume` regenerates approval/refund transactions for the
same pending identity in either `requested` or `submitted`. Issued executable
calldata is irrevocable at the API layer because it may already be signed,
broadcast, or later rebroadcast. The API therefore does not open a replacement
refund slot while that identity is pending. On reorg, a formerly succeeded
refund returns to `submitted`; pending `refund.succeeded` deliveries are
invalidated and a compensating `refund.reorged` event is queued. The public
`GET /v1/payment-intents/:id` response exposes only chain-verified `succeeded`
refunds; requested and submitted records remain merchant-private.

## Errors and limits

Errors have a stable `error.code`, safe `error.message`, and `requestId`.
Validation failures are `400`; authorization failures are `401/403`; conflicts
and stale state use `409`; cap violations use `422`; unavailable chain/signing
dependencies use `503`. Bodies are capped, all routes are rate-limited, and
logs redact auth, cookie, CSRF, SIWE, and signature fields.
