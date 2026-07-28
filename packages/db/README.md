# @giwapay/db

PostgreSQL schema and Drizzle migrations for GiwaPay. The database is the
application's projection of verified chain events; it is not an authority for
payment success.

`migrations/0000_initial.sql` is the baseline for creating a fresh GiwaPay
database; later numbered files are explicit ordered upgrades. The baseline
must never be applied as an in-place upgrade to a hand-created schema. For any
retained environment, back up first and review every pending migration.
`0001_stable_merchant_identity.sql` backfills the stable on-chain merchant and
session-wallet columns from the existing admin records before enforcing the
new constraints.

```bash
DATABASE_URL="$GIWAPAY_DATABASE_URL_FROM_SECRET_MANAGER" \
  pnpm --filter @giwapay/db db:migrate
```

API keys, session tokens, CSRF tokens, and SIWE nonces are stored only as
peppered HMAC-SHA-256 digests. Webhook secrets must be encrypted by the API
before insertion.
