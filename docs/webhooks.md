# Signed webhooks

Webhook endpoints are merchant-owned and managed through:

- `GET/POST /v1/webhook-endpoints`
- `DELETE /v1/webhook-endpoints/:id`
- `GET /v1/webhook-deliveries`

The endpoint secret is encrypted with AES-256-GCM at rest and returned exactly
once. Production URLs must use HTTPS and must not resolve to private or reserved
addresses.

## Delivery

Each request includes:

```text
Content-Type: application/json
User-Agent: GiwaPay-Webhooks/0.1
Idempotency-Key: <event UUID>
GiwaPay-Event-Id: <event UUID>
GiwaPay-Signature: t=<unix-seconds>,v1=<hex HMAC-SHA256>
```

The signed bytes are:

```text
<timestamp>.<raw request body>
```

Verify the signature with the endpoint's `whsec_…` secret using a
constant-time comparison. Reject stale timestamps according to the merchant's
policy (five minutes is a reasonable starting point) and store the event UUID
before side effects.

Node.js verification sketch:

```ts
import { createHmac, timingSafeEqual } from 'node:crypto';

export function verifyGiwaPayWebhook(
  rawBody: Buffer,
  signatureHeader: string,
  secret: string,
  nowSeconds = Math.floor(Date.now() / 1000),
) {
  const fields = Object.fromEntries(signatureHeader.split(',').map((part) => part.split('=', 2)));
  const timestamp = Number(fields.t);
  if (!Number.isSafeInteger(timestamp) || Math.abs(nowSeconds - timestamp) > 300) {
    return false;
  }
  const expected = createHmac('sha256', secret).update(`${timestamp}.`).update(rawBody).digest();
  const presented = Buffer.from(fields.v1 ?? '', 'hex');
  return presented.length === expected.length && timingSafeEqual(presented, expected);
}
```

Do not parse and reserialize JSON before verification.

## Events

- `payment.succeeded`: emitted only from a confirmed, receipt-verified
  `PaymentSucceeded` plus its complete validated `SettlementDistributed` log
  set; `settlementRecipients` is the stored payment-time address/bps/amount
  snapshot, not current registry state
- `refund.succeeded`: emitted only from a confirmed, receipt-verified
  `Refunded`
- `payment.reorged`: compensating event if a previously projected confirmed
  range becomes non-canonical
- `refund.reorged`: compensating event when a previously verified refund is
  removed; the refund projection returns to `submitted`

Resuming a pending `requested` or `submitted` refund emits no webhook because
it is not an on-chain fact and preserves the same refund identity. Executable
refund calldata is irrevocable at the API layer. On reorg, pending, processing,
or retrying stale `payment.succeeded`/`refund.succeeded` deliveries are moved to
`dead_letter` with `invalidated_by_chain_reorganization`; the compensating reorg
event is queued separately. Consumers must still handle a compensation for a
success event that had already been delivered.

Deliveries use PostgreSQL row locks and leases, stable event IDs, exponential
backoff with jitter, claim-version compare-and-set, bounded response capture,
and a dead-letter state. A stale worker cannot overwrite a newer claim.
Delivery is at-least-once; consumers must be idempotent.

The worker does not follow redirects. DNS is checked at endpoint creation and
again immediately before delivery. Operators should additionally enforce
egress firewall/proxy policy because application-level DNS checks alone cannot
fully eliminate DNS-rebinding risk.
