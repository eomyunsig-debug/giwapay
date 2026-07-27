# Contract deployment records

Foundry broadcast artifacts are generated under `packages/contracts/broadcast/`
and intentionally ignored because they contain environment-specific data.

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

Never add a private key, keystore content, RPC credential, secret environment
value, or wallet recovery material to a manifest.

Local manifests are disposable test evidence. GIWA Sepolia manifests are
testnet records and must not be described as mainnet or audited deployments.
This README and the presence of deployment scripts are not deployment
evidence. If no reviewed network manifest is committed alongside it, this
directory records no public deployment.
