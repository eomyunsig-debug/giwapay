# Deployment

## Environments

- **Local Anvil:** chain ID `91342`, loopback only, mock tokens and mock adapter.
- **GIWA Sepolia:** chain ID `91342`, testnet ETH, no mocks by default.
- **Mainnet:** unsupported and intentionally absent from scripts.

Do not reuse the local Anvil wallet/network entry for public GIWA Sepolia.

## Contract deployment

### User-supplied preflight blockers

The repository cannot create or choose any of the following on an operator's
behalf:

- an existing encrypted Foundry keystore account and its unlock method;
- enough GIWA Sepolia ETH for every deployment transaction;
- `PLATFORM_FEE_RECIPIENT`: reviewed nonzero address
- `ADAPTER_MANAGER_ADDRESS`: reviewed nonzero least-privilege manager address
- an explicit immutable `PLATFORM_FEE_BPS` value from `0` through `10000`;
- explicit `PRODUCTION_MODE` and `DEPLOY_TEST_MOCKS` decisions;
- a reviewed, clean Git commit containing the contract and deployment tooling;
- the tracked, unchanged
  `deployments/giwa-sepolia/current.json` `not-deployed` placeholder;
- preferably a dedicated GIWA Sepolia RPC provider.

`GIWA_RPC_URL` defaults to the official public testnet endpoint but should use
a dedicated provider for operated deployments. The wrapper checks both chain
ID `91342` and the reviewed GIWA Sepolia genesis hash, so a local Anvil chain
using the same chain ID does not pass public deployment preflight.
`GIWA_RPC_FALLBACK_URLS` is available to services but is not a broadcast
failover mechanism.

The wrapper requires every immutable mode choice explicitly; it does not apply
an implicit production or fee default. A production-style testnet deployment
uses `PRODUCTION_MODE=true` and `DEPLOY_TEST_MOCKS=false`. To deploy labelled
mocks for a public testnet demo, use `PRODUCTION_MODE=false` and
`DEPLOY_TEST_MOCKS=true`; the deployer must also be the initial adapter manager
for the scripted mock configuration.

From the exact clean commit, a new deployment is intentionally verbose:

```sh
CONFIRM_GIWA_SEPOLIA_DEPLOY=91342 \
GIWAPAY_DEPLOYER_ACCOUNT=my-encrypted-foundry-account \
PLATFORM_FEE_RECIPIENT=0x… \
ADAPTER_MANAGER_ADDRESS=0x… \
PLATFORM_FEE_BPS=50 \
PRODUCTION_MODE=true \
DEPLOY_TEST_MOCKS=false \
pnpm deploy:giwa-sepolia
```

The account name selects an encrypted keystore entry; the script never accepts
a raw private key. Preflight prints only the public deployer address and its
public testnet balance. A new or resumed broadcast refuses a zero balance, but
the operator must still review the simulated gas requirement and maintain a
sufficient buffer.

### Public evidence

Foundry broadcast artifacts remain ignored under
`packages/contracts/broadcast/` because they are machine-local recovery
material. The sanitized
`deployments/giwa-sepolia/current.json` is intentionally trackable and contains
no RPC credential, keystore account name, raw transaction input, or absolute
host path.

A new broadcast requires that exact tracked schema-v2 GIWA Sepolia placeholder.
A missing, malformed, legacy-schema, wrong-network, or evidence-bearing
`current.json` fails before any RPC preflight or Forge invocation; it is never
interpreted as an unused deployment slot.

The public manifest records:

- each tx hash, block, contract address, runtime code hash, constructor args;
- router fee bps/recipient and registry owners/managers;
- source commit and explorer verification;
- earliest indexed block;
- a SHA-256 digest of the private broadcast artifact;
- the Foundry-recorded commit prefix and its match to the reviewed full SHA;
- separate broadcast and verification statuses.

`broadcast-complete` requires a successful receipt for every Foundry broadcast
transaction—not only contract creations—and an explicitly present, empty
`pending` list. It also requires every expected core contract and, when
explicitly requested, every mock. It does **not** mean source verification
succeeded. `verified` is recorded only after a live Blockscout source-code
query confirms every recorded contract. Values such as
`requested-unconfirmed`, `partially-verified`, `broadcast-partial`, and
`evidence-conflict` must not be presented as a verified public deployment.

Runtime code hashes and on-chain owner/fee/manager state are queried through the
configured RPC when available. A missing query is recorded as unavailable
rather than inferred from local bytecode or constructor input. Review the
manifest diff before committing it. Even after explorer source verification,
the wrapper refuses a readiness result unless every runtime code hash and the
expected router owner, registry owner, fee policy, registry references,
production mode, and adapter-manager grant are confirmed on-chain.
`deploymentScopeDirty` reports the contract/deployment-tooling scope enforced by
the wrapper; `fullTreeDirty` separately reports unrelated working-tree changes.
For a recovery operation, `current.json` must itself be tracked, reviewed, and
clean in `HEAD`; this makes its broadcast-artifact hash an independent Git
anchor instead of trusting a simultaneously edited artifact and manifest.

Labelled mock deployments are fail-closed for readiness. The manifest records
`mockReadiness=not-proven` until adapter pair/cap/enabled/test-only/code-hash
state, faucet configuration, minter roles, and adapter liquidity are all
independently proven. The current wrapper does not attempt that broader proof.

Never commit a credential or generated keystore material.

### Failure recovery, resume, and verification

The wrapper writes or refreshes public evidence after the broadcast phase even
when Foundry later returns an error. It never automatically resumes a failed
broadcast. If any attempt produced `run-latest.json`, do not run a new
deployment command:

1. Preserve
   `packages/contracts/broadcast/DeployGiwaSepolia.s.sol/91342/run-latest.json`.
   Inspect its receipts, the deployer nonce, and explorer transactions.
2. Regenerate evidence without sending a transaction:

   ```sh
   RECONCILE_GIWA_SEPOLIA_DEPLOY=91342 \
   RECONCILE_VERIFICATION_REQUESTED=false \
   pnpm deploy:giwa-sepolia
   ```

   Supply the reviewed role/fee/mode variables too when the recovered artifact
   does not contain complete constructor arguments. If neither the existing
   manifest nor recovered evidence identifies the deployment source, also set
   `DEPLOYMENT_SOURCE_COMMIT_OVERRIDE` to the reviewed full commit SHA.
   Review the refreshed `current.json`, then commit that evidence file before
   any resume or standalone verification attempt. Reconciliation never grants
   permission to broadcast.

3. Resume only after confirming that the manifest is partial, the remaining
   nonces are still valid, and the deployment source tree is byte-for-byte
   identical to the recorded source commit. A later commit may contain only
   reviewed evidence or unrelated files; it may not change the contract or
   deployment tooling. Provide the same account, role, fee, and mode variables,
   then use `RESUME_GIWA_SEPOLIA_DEPLOY=91342`. Foundry `--resume` may send only
   pending transactions; it is still a privileged broadcast. The wrapper
   permits this only for a Git-anchored `broadcast-partial` manifest, verifies
   the broadcast artifact SHA-256, and rejects any network, source, deployer,
   role, fee, production, or mock-mode mismatch.
4. If the broadcast is complete but verification failed, do not resume or
   redeploy. Commit the reviewed complete manifest, keep the deployment source
   tree identical to its recorded source commit, and provide the same public
   configuration including `DEPLOYER_ADDRESS`. Then use
   `VERIFY_GIWA_SEPOLIA_DEPLOY=91342`. This path never opens a keystore and never
   invokes `--broadcast`, `--resume`, or `--account`; it submits
   `forge verify-contract` separately for each manifest address and creation
   transaction. It is permitted only for a Git-anchored, hash-matching
   `broadcast-complete` artifact.
5. If verification was submitted successfully but Blockscout is still
   indexing, run the read-only reconcile command later with
   `RECONCILE_VERIFICATION_REQUESTED=true`. This updates the observed status
   without broadcasting.

If the broadcast artifact is lost, the wrapper intentionally refuses resume.
Recover it from protected operator storage and reconcile every receipt; never
clear the guard or start a replacement deployment merely to recreate a
manifest. Before an intentional later replacement, archive the reviewed public
manifest and recovery artifact under an immutable release record, then reset
the `current.json` placeholder in a reviewed commit.

During reconcile, supplied role/fee/mode values are comparison inputs only.
They cannot overwrite recorded configuration; any mismatch changes the
manifest to `evidence-conflict`. Reconciliation preserves an existing boolean
`deploymentScopeDirty` value. It may promote a `null` value to `false` only
when `current.json` is tracked and clean before extraction and the current
deployment source paths match the recorded source commit; otherwise the value
stays `null` or otherwise untrusted and RESUME/VERIFY remain fail-closed.

Registry ownership acceptance is a privileged state transition. When the
pending owner calls `AdapterRegistry.acceptOwnership`, the contract revokes
adapter-manager authority retained by the previous owner. Verify the new owner,
the configured `ADAPTER_MANAGER_ADDRESS`, and the previous owner's revoked
manager state on-chain before enabling application traffic.

Adapter registration rejects bytecode containing the executable
`DELEGATECALL` opcode, excluding delegatecall-based proxies and mutable
implementation routing. Runtime code-hash pinning then detects bytecode
replacement on every payment. This does not prove an adapter's economics or
external dependencies are safe: review verified source, token pairs, input
caps, ownership, and every external call before registration.

## Application configuration

Copy `.env.example` outside source control and supply secrets through the
deployment platform. Required production boundaries include:

- independently operated primary and fallback RPC providers;
- exact verified router, merchant registry, and adapter registry addresses;
- platform fee bps matching the immutable router value;
- supported token/route JSON matching on-chain adapter metadata;
- `PAYMENT_INTENT_SIGNER_SOURCE=database`, a dedicated KMS readiness key, and
  one operator-provisioned non-exportable KMS signer mapping per merchant;
- PostgreSQL TLS/backup settings;
- strong independent session, API-key pepper, and 32-byte webhook encryption
  keys;
- exact HTTPS web/API origins and production cookie domain.
- `EXPOSE_API_DOCS=false` unless public Swagger/OpenAPI routes are an explicit
  product requirement.

`NEXT_PUBLIC_*` values are public and are embedded at web image build time.
Never place a private key, API secret, or database credential in those values.
WalletConnect is omitted unless its public project ID is configured.

## Database baseline

`packages/db/migrations/0000_initial.sql` is the **fresh, empty database**
baseline, not a generic reconciliation script for hand-created tables.
Subsequent numbered files are explicit ordered upgrades.
`0001_stable_merchant_identity.sql` backfills stable merchant identity and
session-wallet ownership from the pre-existing admin relationship before
adding non-null and uniqueness constraints. Before applying pending migrations
to retained data, take a tested backup, review the migration sequence, and
stop chain projection/webhook delivery for the maintenance window.
`0003_merchant_signer_keys.sql` adds the non-secret KMS key-ID/public-address
mapping table. Apply it before starting an API image configured with the
database signer source.

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
