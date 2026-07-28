# Deployment

## Environments

- **Local Anvil:** chain ID `91342`, loopback only, mock tokens and mock adapter.
- **GIWA Sepolia:** chain ID `91342`, testnet ETH, no mocks by default.
- **Mainnet:** unsupported and intentionally absent from scripts.

Do not reuse the local Anvil wallet/network entry for public GIWA Sepolia.

## Contract deployment

The opt-in wrapper requires:

- `CONFIRM_GIWA_SEPOLIA_DEPLOY=91342`
- `GIWAPAY_DEPLOYER_ACCOUNT`: an existing encrypted Foundry keystore name
- `PLATFORM_FEE_RECIPIENT`: reviewed nonzero address
- `ADAPTER_MANAGER_ADDRESS`: reviewed nonzero least-privilege manager address
- a funded public deployer address resolved from the keystore

`GIWA_RPC_URL` defaults to the official public testnet endpoint but should use
a dedicated provider for operated deployments. `GIWA_RPC_FALLBACK_URLS` is
available to services. The wrapper queries the endpoint's chain ID before
broadcast and uses Blockscout verification.

Production-style testnet mode defaults to `PRODUCTION_MODE=true`, which rejects
test-only adapters. To deploy labelled mocks for a public testnet demo, both
`PRODUCTION_MODE=false` and `DEPLOY_TEST_MOCKS=true` must be explicit.

After deployment, review the generated manifest and record:

- each tx hash, block, contract address, runtime code hash, constructor args;
- router fee bps/recipient and registry owners/managers;
- source commit and explorer verification;
- earliest indexed block.

Never commit a credential or generated keystore material.

Registry ownership acceptance is a privileged state transition. When the
pending owner calls `AdapterRegistry.acceptOwnership`, the contract revokes
adapter-manager authority retained by the previous owner. Verify the new owner,
the configured `ADAPTER_MANAGER_ADDRESS`, and the previous owner's revoked
manager state on-chain before enabling application traffic.

## Application configuration

Copy `.env.example` outside source control and supply secrets through the
deployment platform. Required production boundaries include:

- independently operated primary and fallback RPC providers;
- exact verified router, merchant registry, and adapter registry addresses;
- platform fee bps matching the immutable router value;
- supported token/route JSON matching on-chain adapter metadata;
- a delegated PaymentIntent signer whose address each merchant registers;
- PostgreSQL TLS/backup settings;
- strong independent session, API-key pepper, and 32-byte webhook encryption
  keys;
- exact HTTPS web/API origins and production cookie domain.

`NEXT_PUBLIC_*` values are public and are embedded at web image build time.
Never place a private key, API secret, or database credential in those values.
WalletConnect is omitted unless its public project ID is configured.

## Database baseline

`packages/db/migrations/0000_initial.sql` creates the current schema on a
**fresh, empty database**. It is the repository's initial baseline, not an
in-place migration from a prior GiwaPay schema and not a generic reconciliation
script for hand-created tables. Disposable local and CI databases may be
recreated. Before applying anything to retained data, take a tested backup and
write/review an explicit migration or rebuild the chain projection with
webhook delivery stopped.

## Containers

Build locally:

```sh
docker build -f apps/api/Dockerfile -t giwapay-api:0.1.0 .
docker build -f apps/web/Dockerfile -t giwapay-web:0.1.0 .
```

Production Compose deliberately does not bundle PostgreSQL or a reverse proxy.
Set `GIWAPAY_API_IMAGE` and `GIWAPAY_WEB_IMAGE`, then:

```sh
docker compose --env-file .env.production \
  -f docker-compose.prod.yml up -d
```

The production Compose file binds web and API to host loopback on ports `3000`
and `3001` by default, configurable through `GIWAPAY_WEB_PORT` and
`GIWAPAY_API_PORT`. Terminate TLS in a reviewed host ingress or Tailscale Serve,
and configure only its exact proxy CIDR as trusted. PostgreSQL, the indexer, and
the webhook worker remain private. Run one indexer per router—the worker
enforces this with a PostgreSQL advisory lock.

## Tailscale-compatible workflow

`.github/workflows/deploy-tailscale.yml` is manual-only. It verifies the source,
builds commit-addressed images, publishes them to GHCR, joins a tailnet with an
ephemeral tagged node, verifies that the remote production Compose SHA-256
matches the source commit, and updates a pre-provisioned host over Tailscale
SSH.
The host must already contain:

- this release's `docker-compose.prod.yml`;
- a permission-restricted `.env.production`;
- Docker Compose;
- ACL grants for the CI tag to reach only the deployment target.

Configure GitHub environment `giwa-sepolia` secrets/variables documented in the
workflow. Use a least-privileged OAuth client and protect the environment with
reviewers. The workflow deploys no contracts and cannot infer that a pushed
image is healthy; it explicitly waits for the API readiness probe.

## Rollback

Application images are immutable by commit SHA. Roll back by setting the two
image variables to the last known-good SHA and running Compose. Do not roll back
contract addresses or database migrations blindly. In particular, never run
the fresh-database `0000_initial.sql` baseline as a rollback or upgrade against
an existing schema. Because contracts are non-upgradeable, a contract
replacement requires a new deployment manifest, new router-bound
PaymentIntents, and an explicit service configuration change.

Deployment scripts, workflows, and this runbook are capabilities, not evidence
that GIWA Sepolia was deployed. Only a reviewed manifest with transaction,
block, bytecode, explorer, and source-commit evidence can establish a public
testnet deployment.
