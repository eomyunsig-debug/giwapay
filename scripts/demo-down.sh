#!/usr/bin/env bash
set -euo pipefail

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
demo_environment="$repository_root/.env.demo"
manifest_path="$repository_root/deployments/local/current.json"

cleanup_generated_files() {
  local exit_status=$?
  local cleanup_status

  trap - EXIT
  if rm -f "$demo_environment" "$manifest_path"; then
    cleanup_status=0
  else
    cleanup_status=$?
  fi

  if ((exit_status == 0 && cleanup_status != 0)); then
    exit_status=$cleanup_status
  fi

  exit "$exit_status"
}

trap cleanup_generated_files EXIT

if [[ -f "$demo_environment" ]]; then
  docker compose --env-file "$demo_environment" \
    -f "$repository_root/docker-compose.yml" down --volumes --remove-orphans
else
  docker compose -f "$repository_root/docker-compose.yml" \
    down --volumes --remove-orphans
fi

echo "Removed GiwaPay demo containers, demo database volume, and local generated configuration."
