#!/usr/bin/env bash
set -euo pipefail

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
contracts_dir="$repository_root/packages/contracts"
manifest_path="$repository_root/deployments/giwa-sepolia/current.json"

if [[ "${CONFIRM_GIWA_SEPOLIA_DEPLOY:-}" != "91342" ]]; then
  echo "Refusing to broadcast. Set CONFIRM_GIWA_SEPOLIA_DEPLOY=91342 for an explicit testnet deployment." >&2
  exit 1
fi

if [[ -z "${GIWAPAY_DEPLOYER_ACCOUNT:-}" ]]; then
  echo "GIWAPAY_DEPLOYER_ACCOUNT must name an existing encrypted Foundry keystore account." >&2
  exit 1
fi

require_nonzero_address() {
  local variable_name="$1"
  local value="${!variable_name:-}"
  if [[ ! "$value" =~ ^0x[0-9a-fA-F]{40}$ ]] ||
    [[ "$value" == "0x0000000000000000000000000000000000000000" ]]; then
    echo "$variable_name must be an explicit nonzero EVM address." >&2
    exit 1
  fi
}

require_nonzero_address PLATFORM_FEE_RECIPIENT
require_nonzero_address ADAPTER_MANAGER_ADDRESS

for executable in forge cast node; do
  if ! command -v "$executable" >/dev/null 2>&1; then
    echo "Required executable is unavailable: $executable" >&2
    exit 1
  fi
done

giwa_rpc_url="${GIWA_RPC_URL:-https://sepolia-rpc.giwa.io}"
actual_chain_id="$(cast chain-id --rpc-url "$giwa_rpc_url")"
if [[ "$actual_chain_id" != "91342" ]]; then
  echo "Refusing to deploy: configured RPC reported chain ID $actual_chain_id, expected 91342." >&2
  exit 1
fi

if [[ "${PRODUCTION_MODE:-true}" == "true" && "${DEPLOY_TEST_MOCKS:-false}" == "true" ]]; then
  echo "Test mocks cannot be deployed with PRODUCTION_MODE=true." >&2
  exit 1
fi

export DEPLOYER_ADDRESS
DEPLOYER_ADDRESS="$(cast wallet address --account "$GIWAPAY_DEPLOYER_ACCOUNT")"

(
  cd "$contracts_dir"
  forge script script/DeployGiwaSepolia.s.sol:DeployGiwaSepolia \
    --account "$GIWAPAY_DEPLOYER_ACCOUNT" \
    --rpc-url "$giwa_rpc_url" \
    --broadcast \
    --verify \
    --verifier blockscout \
    --verifier-url "${GIWA_EXPLORER_API_URL:-https://sepolia-explorer.giwa.io/api}"
)

node "$repository_root/scripts/extract-deployment.mjs" \
  "$contracts_dir/broadcast/DeployGiwaSepolia.s.sol/91342/run-latest.json" \
  "$manifest_path" \
  91342 \
  giwa-sepolia

echo "GIWA Sepolia deployment completed. Review $manifest_path and explorer verification before configuring services."
