# GIWA network source notes

Verified on **2026-07-30** against GIWA's official documentation and read-only
`eth_chainId` and block `0` calls to the public endpoint.

| Field                           | Value                                     |
| ------------------------------- | ----------------------------------------- |
| Network                         | GIWA Sepolia                              |
| Chain ID                        | `91342` (`0x164ce`)                       |
| Native currency                 | ETH                                       |
| Genesis block hash              | `0xca1b5fee…7004cab2`                     |
| Default public RPC              | `https://sepolia-rpc.giwa.io`             |
| Optional public Flashblocks RPC | `https://sepolia-rpc-flashblocks.giwa.io` |
| Explorer                        | `https://sepolia-explorer.giwa.io`        |
| Faucet                          | `https://faucet.giwa.io`                  |

Primary sources:

- [Connect to GIWA](https://docs.giwa.io/get-started/connect-to-giwa)
- [Develop with Foundry](https://docs.giwa.io/get-started/smart-contract/develop/foundry)
- [GIWA website](https://giwa.io/)

The official documentation marks the public endpoints as rate-limited and not
suitable as production infrastructure. `GIWA_RPC_URL` therefore takes
precedence and `GIWA_RPC_FALLBACK_URLS` may list independent fallbacks. No
unofficial token or contract address is defined.

The deployment wrapper checks the full genesis hash
`0xca1b5fee64a196abfca007b3a4d4e3ec2b37be83a452d452bf4e45937004cab2`
in addition to chain ID. This read-only network fingerprint prevents the local
Anvil chain, which intentionally shares chain ID `91342`, from being mistaken
for public GIWA Sepolia. A future testnet reset must fail closed until the new
genesis is independently reviewed.

The official website currently presents GIWA Wallet and the stablecoin/paymaster
ecosystem as coming soon. GiwaPay consequently uses standard injected wallet
interfaces and ships only a disabled gas-sponsorship implementation.
