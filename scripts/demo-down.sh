#!/usr/bin/env bash
set -euo pipefail

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
demo_environment="$repository_root/.env.demo"
manifest_path="$repository_root/deployments/local/current.json"

if [[ -f "$demo_environment" ]]; then
  docker compose --env-file "$demo_environment" \
    -f "$repository_root/docker-compose.yml" down --volumes --remove-orphans
else
  docker compose -f "$repository_root/docker-compose.yml" \
    down --volumes --remove-orphans
fi

rm -f "$demo_environment" "$manifest_path"
echo "Removed GiwaPay demo containers, demo database volume, and local generated configuration."
