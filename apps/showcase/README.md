# GiwaPay public showcase

This is the deliberately non-transactional public presentation surface for the
GiwaPay testnet MVP.

It explains the implemented payment path, verification evidence, and security
boundaries without pretending that contracts or a live payment backend have
been deployed to GIWA Sepolia.

```sh
pnpm --filter @giwapay/showcase dev
pnpm --filter @giwapay/showcase test
```

The executable product remains in `apps/web`, `apps/api`, and the shared
packages. See the repository root README for the local Anvil acceptance flow.
