# GIWA network source notes

Verified on **2026-07-28** against GIWA's official documentation and a read-only
`eth_chainId` call to the public endpoint.

| Field                           | Value                                     |
| ------------------------------- | ----------------------------------------- |
| Network                         | GIWA Sepolia                              |
| Chain ID                        | `91342` (`0x164ce`)                       |
| Native currency                 | ETH                                       |
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

The official website currently presents GIWA Wallet and the stablecoin/paymaster
ecosystem as coming soon. GiwaPay consequently uses standard injected wallet
interfaces and ships only a disabled gas-sponsorship implementation.
