#!/usr/bin/env bash
set -euo pipefail

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
demo_environment="$repository_root/.env.demo"
manifest_path="$repository_root/deployments/local/current.json"
local_rpc_url="http://127.0.0.1:8545"
local_sender="0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266"

for executable in docker forge cast node openssl; do
  if ! command -v "$executable" >/dev/null 2>&1; then
    echo "Required local demo tool is unavailable: $executable" >&2
    exit 1
  fi
done

if [[ -e "$demo_environment" ]]; then
  echo "A demo environment already exists. Run pnpm demo:down before starting a fresh demo." >&2
  exit 1
fi

umask 077
postgres_password="$(openssl rand -hex 24)"
session_secret="$(openssl rand -hex 32)"
api_key_pepper="$(openssl rand -hex 32)"
webhook_key="$(openssl rand -base64 32 | tr -d '\n')"
intent_signer_key="0x$(openssl rand -hex 32)"

{
  printf 'COMPOSE_PROJECT_NAME=giwapay-demo\n'
  printf 'POSTGRES_DB=giwapay\n'
  printf 'POSTGRES_USER=giwapay\n'
  printf 'POSTGRES_PASSWORD=%s\n' "$postgres_password"
  printf 'DATABASE_URL=postgresql://giwapay:%s@postgres:5432/giwapay\n' "$postgres_password"
  printf 'ALLOWED_ORIGINS=http://127.0.0.1:3000,http://localhost:3000\n'
  printf 'WEB_BASE_URL=http://127.0.0.1:3000\n'
  printf 'PUBLIC_API_URL=http://127.0.0.1:3001\n'
  printf 'NEXT_PUBLIC_APP_URL=http://127.0.0.1:3000\n'
  printf 'NEXT_PUBLIC_API_URL=http://127.0.0.1:3001\n'
  printf 'NEXT_PUBLIC_GIWA_RPC_URL=http://127.0.0.1:8545\n'
  printf 'SESSION_SECRET=%s\n' "$session_secret"
  printf 'API_KEY_PEPPER=%s\n' "$api_key_pepper"
  printf 'WEBHOOK_ENCRYPTION_KEY=%s\n' "$webhook_key"
  printf 'PAYMENT_INTENT_SIGNER_PRIVATE_KEY=%s\n' "$intent_signer_key"
  printf 'PLATFORM_FEE_BPS=50\n'
} >"$demo_environment"
chmod 600 "$demo_environment"

cleanup_on_error() {
  docker compose --env-file "$demo_environment" \
    -f "$repository_root/docker-compose.yml" down --remove-orphans >/dev/null 2>&1 || true
  rm -f "$demo_environment" "$manifest_path"
}
trap cleanup_on_error ERR INT TERM

docker compose --env-file "$demo_environment" \
  -f "$repository_root/docker-compose.yml" up -d postgres anvil

for _attempt in $(seq 1 60); do
  if [[ "$(cast chain-id --rpc-url "$local_rpc_url" 2>/dev/null || true)" == "91342" ]]; then
    break
  fi
  sleep 1
done
if [[ "$(cast chain-id --rpc-url "$local_rpc_url" 2>/dev/null || true)" != "91342" ]]; then
  echo "Local Anvil did not become ready with chain ID 91342." >&2
  exit 1
fi

(
  cd "$repository_root/packages/contracts"
  DEPLOYER_ADDRESS="$local_sender" \
  PLATFORM_FEE_RECIPIENT="$local_sender" \
  PLATFORM_FEE_BPS=50 \
    forge script script/DeployLocal.s.sol:DeployLocal \
      --rpc-url "$local_rpc_url" \
      --sender "$local_sender" \
      --unlocked \
      --broadcast
)

node "$repository_root/scripts/extract-deployment.mjs" \
  "$repository_root/packages/contracts/broadcast/DeployLocal.s.sol/91342/run-latest.json" \
  "$manifest_path" \
  91342 \
  local-anvil
node "$repository_root/scripts/render-demo-env.mjs" \
  "$demo_environment" \
  "$manifest_path"

docker compose --env-file "$demo_environment" \
  -f "$repository_root/docker-compose.yml" up -d --build

trap - ERR INT TERM

echo "GiwaPay local demo is running at http://127.0.0.1:3000"
echo "API documentation: http://127.0.0.1:3001/docs"
echo "Fund only a public test wallet address with: ./scripts/fund-demo-wallet.sh 0x..."
