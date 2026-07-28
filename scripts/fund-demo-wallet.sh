#!/usr/bin/env bash
set -euo pipefail

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
manifest_path="$repository_root/deployments/local/current.json"
local_rpc_url="http://127.0.0.1:8545"
local_sender="0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266"
wallet_address="${1:-}"

if [[ ! "$wallet_address" =~ ^0x[0-9a-fA-F]{40}$ ]]; then
  echo "Usage: ./scripts/fund-demo-wallet.sh <public EVM wallet address>" >&2
  exit 1
fi
if [[ ! -f "$manifest_path" ]]; then
  echo "Local deployment manifest is missing. Run pnpm demo:up first." >&2
  exit 1
fi
for executable in cast node; do
  if ! command -v "$executable" >/dev/null 2>&1; then
    echo "Required executable is unavailable: $executable" >&2
    exit 1
  fi
done
if [[ "$(cast chain-id --rpc-url "$local_rpc_url")" != "91342" ]]; then
  echo "Refusing to fund: local RPC is not chain ID 91342." >&2
  exit 1
fi

token_addresses="$(
  node -e '
    const fs = require("node:fs");
    const manifest = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    const addresses = [];
    for (const key of ["mockKRW", "mockUSDC", "mockALT"]) {
      const address = manifest.contracts?.[key];
      if (!/^0x[0-9a-fA-F]{40}$/.test(address ?? "")) process.exit(1);
      addresses.push(address);
    }
    process.stdout.write(addresses.join(" "));
  ' "$manifest_path"
)"
IFS=' ' read -r mock_krw_address mock_usdc_address mock_alt_address <<<"$token_addresses"
if [[ -z "$mock_krw_address" || -z "$mock_usdc_address" || -z "$mock_alt_address" ]]; then
  echo "Local manifest does not contain all demo tokens." >&2
  exit 1
fi

cast rpc --rpc-url "$local_rpc_url" anvil_setBalance \
  "$wallet_address" "0x21e19e0c9bab2400000" >/dev/null
cast send --rpc-url "$local_rpc_url" --unlocked --from "$local_sender" \
  "$mock_krw_address" "mint(address,uint256)" "$wallet_address" "1000000000000" >/dev/null
cast send --rpc-url "$local_rpc_url" --unlocked --from "$local_sender" \
  "$mock_usdc_address" "mint(address,uint256)" "$wallet_address" "1000000000" >/dev/null
cast send --rpc-url "$local_rpc_url" --unlocked --from "$local_sender" \
  "$mock_alt_address" "mint(address,uint256)" "$wallet_address" "1000000000000000000000" >/dev/null

echo "Funded the public address with local-only test ETH, MockKRW, MockUSDC, and MockALT."
