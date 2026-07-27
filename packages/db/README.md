# @giwapay/db

PostgreSQL schema and Drizzle migrations for GiwaPay. The database is the
application's projection of verified chain events; it is not an authority for
payment success.

`migrations/0000_initial.sql` is a baseline for creating a fresh GiwaPay
database. It is not an in-place upgrade path for an older or hand-created
schema. For disposable local/CI environments, recreate a clean database. For
any retained environment, back up and validate an explicit reviewed migration
or rebuild the projection before running this baseline.

```bash
DATABASE_URL="$GIWAPAY_DATABASE_URL_FROM_SECRET_MANAGER" \
  pnpm --filter @giwapay/db db:migrate
```

API keys, session tokens, CSRF tokens, and SIWE nonces are stored only as
peppered HMAC-SHA-256 digests. Webhook secrets must be encrypted by the API
before insertion.
