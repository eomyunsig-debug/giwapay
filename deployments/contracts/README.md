# Contract deployment records

Foundry broadcast artifacts are generated under `packages/contracts/broadcast/`
and intentionally ignored because they contain environment-specific data.
The reviewed, sanitized GIWA Sepolia summary is written separately to
`deployments/giwa-sepolia/current.json`. That one exact JSON path is trackable;
all other generated network JSON remains ignored.

After an intentional deployment, record a reviewed manifest in the matching
network directory with:

- chain ID and network name;
- transaction hash and block number for each deployment;
- deployed runtime bytecode hash;
- contract address and constructor arguments;
- git commit SHA;
- `platformFeeBps`, fee recipient, owner, and adapter manager;
- evidence that `ADAPTER_MANAGER_ADDRESS` was explicit and nonzero;
- after ownership acceptance, evidence that any adapter-manager permission held
  by the previous owner was revoked;
- whether `productionMode` was enabled;
- explorer verification links.

Never add a private key, keystore account name or content, RPC credential,
secret environment value, absolute operator path, or wallet recovery material
to a public manifest.

Local manifests are disposable test evidence. GIWA Sepolia manifests are
testnet records and must not be described as mainnet or audited deployments.
This README and the presence of deployment scripts are not deployment
evidence. If no reviewed network manifest is committed alongside it, this
directory records no public deployment.
