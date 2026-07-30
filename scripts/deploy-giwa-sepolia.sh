#!/usr/bin/env bash
set -euo pipefail

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
contracts_dir="$repository_root/packages/contracts"
broadcast_dir="$contracts_dir/broadcast/DeployGiwaSepolia.s.sol/91342"
legacy_broadcast_path="$broadcast_dir/run-latest.json"
broadcast_path="$legacy_broadcast_path"
manifest_path="$repository_root/deployments/giwa-sepolia/current.json"
manifest_relative_path="deployments/giwa-sepolia/current.json"
expected_chain_id="91342"
expected_genesis_hash="0xca1b5fee64a196abfca007b3a4d4e3ec2b37be83a452d452bf4e45937004cab2"
reviewed_worktree_checker="$repository_root/scripts/assert-reviewed-worktree.mjs"
broadcast_source_paths=(
  .env
  packages/contracts/src
  packages/contracts/script/DeployGiwaSepolia.s.sol
  packages/contracts/foundry.toml
  packages/contracts/remappings.txt
  packages/contracts/.env
  packages/contracts/lib/forge-std
  packages/contracts/lib/openzeppelin-contracts
)
evidence_tooling_paths=(
  scripts/deploy-giwa-sepolia.sh
  scripts/extract-deployment.mjs
  scripts/assert-reviewed-worktree.mjs
  package.json
  pnpm-lock.yaml
)
sealed_repository_root=""

cleanup_sealed_repository() {
  if [[ -n "$sealed_repository_root" && -d "$sealed_repository_root" ]]; then
    rm -rf -- "$sealed_repository_root"
  fi
}
trap cleanup_sealed_repository EXIT

fail() {
  echo "$*" >&2
  exit 1
}

lowercase() {
  printf '%s' "$1" | tr '[:upper:]' '[:lower:]'
}

reviewed_git() {
  env \
    -u GIT_DIR \
    -u GIT_WORK_TREE \
    -u GIT_INDEX_FILE \
    -u GIT_COMMON_DIR \
    -u GIT_OBJECT_DIRECTORY \
    -u GIT_ALTERNATE_OBJECT_DIRECTORIES \
    -u GIT_REPLACE_REF_BASE \
    -u GIT_NAMESPACE \
    -u GIT_SHALLOW_FILE \
    -u GIT_CONFIG_COUNT \
    -u GIT_CONFIG_PARAMETERS \
    -u GIT_CONFIG_GLOBAL \
    -u GIT_CONFIG_SYSTEM \
    GIT_NO_REPLACE_OBJECTS=1 \
    git "$@"
}

for executable in forge cast node git tar mktemp; do
  if ! command -v "$executable" >/dev/null 2>&1; then
    fail "Required executable is unavailable: $executable"
  fi
done
foundry_override_names=()
git_redirect_names=()
while IFS= read -r environment_name; do
  case "$environment_name" in
    FOUNDRY_* | DAPP_* | ETH_GAS_PRICE | ETH_PRIORITY_GAS_PRICE)
      foundry_override_names+=("$environment_name")
      ;;
    GIT_DIR | GIT_WORK_TREE | GIT_INDEX_FILE | GIT_COMMON_DIR | GIT_OBJECT_DIRECTORY | \
      GIT_ALTERNATE_OBJECT_DIRECTORIES | GIT_REPLACE_REF_BASE | GIT_NAMESPACE | \
      GIT_SHALLOW_FILE | GIT_CONFIG_COUNT | GIT_CONFIG_PARAMETERS | GIT_CONFIG_GLOBAL | \
      GIT_CONFIG_SYSTEM | GIT_CONFIG_KEY_* | GIT_CONFIG_VALUE_*)
      git_redirect_names+=("$environment_name")
      ;;
  esac
done < <(compgen -e)
if ((${#foundry_override_names[@]} > 0)); then
  fail "Unset inherited Foundry/Dapp configuration overrides before deployment: ${foundry_override_names[*]}"
fi
if ((${#git_redirect_names[@]} > 0)); then
  fail "Unset inherited Git repository/configuration redirects before deployment: ${git_redirect_names[*]}"
fi
node --check "$repository_root/scripts/extract-deployment.mjs" >/dev/null
node --check "$reviewed_worktree_checker" >/dev/null
replacement_refs="$(reviewed_git -C "$repository_root" replace -l)"
[[ -z "$replacement_refs" ]] ||
  fail "Git replacement refs are not allowed for deployment or recovery."
[[ ! -e "$manifest_path" || -w "$manifest_path" ]] ||
  fail "The public deployment manifest is not writable."
node -e '
  const url = new URL(process.argv[1]);
  if (!["http:", "https:"].includes(url.protocol) ||
      url.username || url.password || url.search || url.hash) {
    process.exit(1);
  }
' "${GIWA_EXPLORER_URL:-https://sepolia-explorer.giwa.io}" ||
  fail "GIWA_EXPLORER_URL must be a credential-free public HTTP(S) base URL."

reconcile_requested="${RECONCILE_GIWA_SEPOLIA_DEPLOY:-}"
resume_requested="${RESUME_GIWA_SEPOLIA_DEPLOY:-}"
verify_requested="${VERIFY_GIWA_SEPOLIA_DEPLOY:-}"
recovery_mode_count=0
[[ -n "$reconcile_requested" ]] && recovery_mode_count=$((recovery_mode_count + 1))
[[ -n "$resume_requested" ]] && recovery_mode_count=$((recovery_mode_count + 1))
[[ -n "$verify_requested" ]] && recovery_mode_count=$((recovery_mode_count + 1))
if ((recovery_mode_count > 1)); then
  fail "Select only one recovery operation: reconcile, resume, or verify."
fi

operation="deploy"
if [[ -n "$reconcile_requested" ]]; then
  [[ "$reconcile_requested" == "$expected_chain_id" ]] ||
    fail "RECONCILE_GIWA_SEPOLIA_DEPLOY must equal $expected_chain_id."
  operation="reconcile"
elif [[ -n "$resume_requested" ]]; then
  [[ "$resume_requested" == "$expected_chain_id" ]] ||
    fail "RESUME_GIWA_SEPOLIA_DEPLOY must equal $expected_chain_id."
  operation="resume"
elif [[ -n "$verify_requested" ]]; then
  [[ "$verify_requested" == "$expected_chain_id" ]] ||
    fail "VERIFY_GIWA_SEPOLIA_DEPLOY must equal $expected_chain_id."
  operation="verify"
else
  [[ "${CONFIRM_GIWA_SEPOLIA_DEPLOY:-}" == "$expected_chain_id" ]] ||
    fail "Refusing to broadcast. Set CONFIRM_GIWA_SEPOLIA_DEPLOY=$expected_chain_id for an explicit new testnet deployment."
fi

if [[ "$operation" == "deploy" ]]; then
  [[ -f "$manifest_path" ]] ||
    fail "A new deployment requires the tracked GIWA Sepolia not-deployed manifest placeholder."
  node -e '
    const fs = require("node:fs");
    const path = process.argv[1];
    const isEmptyRecord = (value) =>
      value !== null &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      Object.keys(value).length === 0;
    let manifest;
    try {
      manifest = JSON.parse(fs.readFileSync(path, "utf8"));
    } catch {
      process.exit(1);
    }
    const valid =
      manifest !== null &&
      typeof manifest === "object" &&
      !Array.isArray(manifest) &&
      manifest.schemaVersion === 2 &&
      manifest.project === "GiwaPay" &&
      manifest.chainId === 91342 &&
      manifest.mode === "giwa-sepolia" &&
      manifest.deploymentStatus === "not-deployed" &&
      manifest.sourceCommit === null &&
      manifest.evidenceToolingCommit === null &&
      manifest.deploymentScopeDirty === null &&
      manifest.fullTreeDirty === null &&
      isEmptyRecord(manifest.contracts) &&
      isEmptyRecord(manifest.contractEvidence) &&
      Array.isArray(manifest.configurationConflicts) &&
      manifest.configurationConflicts.length === 0 &&
      manifest.mockReadiness?.status === "unknown" &&
      manifest.verification?.requested === false &&
      manifest.verification?.status === "not-requested" &&
      isEmptyRecord(manifest.verification?.contracts) &&
      !Object.hasOwn(manifest, "broadcastArtifact") &&
      !Object.hasOwn(manifest, "configuration") &&
      !Object.hasOwn(manifest, "deployments");
    if (!valid) process.exit(1);
  ' "$manifest_path" ||
    fail "A new deployment requires the exact reviewed GIWA Sepolia not-deployed manifest placeholder; malformed, legacy, wrong-network, or evidence-bearing manifests are blocked."
fi

if ! reviewed_git -C "$repository_root" ls-files --error-unmatch "$manifest_relative_path" >/dev/null 2>&1; then
  fail "The public deployment manifest must be tracked in the reviewed commit before any deployment or recovery operation."
fi
manifest_head_blob="$(
  reviewed_git -C "$repository_root" rev-parse "HEAD:$manifest_relative_path"
)" || fail "The public deployment manifest must exist in the reviewed HEAD commit."
manifest_worktree_blob="$(
  reviewed_git -C "$repository_root" hash-object --no-filters "$manifest_path"
)" || fail "The public deployment manifest could not be hashed for an exact HEAD comparison."
if [[ "$(lowercase "$manifest_worktree_blob")" != "$(lowercase "$manifest_head_blob")" ]]; then
  fail "The public deployment manifest must exactly match the reviewed HEAD blob before any deployment or recovery operation."
fi
manifest_status="$(
  reviewed_git -C "$repository_root" status --porcelain -- "$manifest_relative_path"
)"
if [[ -n "$manifest_status" ]]; then
  fail "The public deployment manifest must be clean in the reviewed commit before any deployment or recovery operation."
fi

current_source_commit="$(reviewed_git -C "$repository_root" rev-parse HEAD)"
source_commit="$current_source_commit"
evidence_tooling_commit="$current_source_commit"
existing_manifest_status="$(
  node -e '
    const fs = require("node:fs");
    const path = process.argv[1];
    try {
      const manifest = JSON.parse(fs.readFileSync(path, "utf8"));
      process.stdout.write(typeof manifest.deploymentStatus === "string" ? manifest.deploymentStatus : "unknown");
    } catch {
      process.stdout.write("missing");
    }
  ' "$manifest_path"
)"
existing_manifest_source_commit="$(
  node -e '
    const fs = require("node:fs");
    const path = process.argv[1];
    try {
      const manifest = JSON.parse(fs.readFileSync(path, "utf8"));
      process.stdout.write(/^[0-9a-fA-F]{40}$/.test(manifest.sourceCommit ?? "") ? manifest.sourceCommit : "");
    } catch {}
  ' "$manifest_path"
)"
existing_manifest_evidence_tooling_commit="$(
  node -e '
    const fs = require("node:fs");
    const path = process.argv[1];
    try {
      const manifest = JSON.parse(fs.readFileSync(path, "utf8"));
      process.stdout.write(
        /^[0-9a-fA-F]{40}$/.test(manifest.evidenceToolingCommit ?? "")
          ? manifest.evidenceToolingCommit
          : "",
      );
    } catch {}
  ' "$manifest_path"
)"
existing_manifest_scope_dirty="$(
  node -e '
    const fs = require("node:fs");
    const path = process.argv[1];
    try {
      const value = JSON.parse(fs.readFileSync(path, "utf8")).deploymentScopeDirty;
      process.stdout.write(
        value === true ? "true" : value === false ? "false" : value === null ? "null" : "unknown",
      );
    } catch {
      process.stdout.write("unknown");
    }
  ' "$manifest_path"
)"
existing_manifest_broadcast_sha256="$(
  node -e '
    const fs = require("node:fs");
    const path = process.argv[1];
    try {
      const manifest = JSON.parse(fs.readFileSync(path, "utf8"));
      if (!Object.hasOwn(manifest, "broadcastArtifact")) {
        process.stdout.write("none");
      } else if (/^[0-9a-fA-F]{64}$/.test(manifest.broadcastArtifact?.sha256 ?? "")) {
        process.stdout.write(manifest.broadcastArtifact.sha256.toLowerCase());
      } else {
        process.stdout.write("invalid");
      }
    } catch {
      process.stdout.write("invalid");
    }
  ' "$manifest_path"
)"

if [[ "$operation" == "deploy" ]]; then
  [[ ! -e "$broadcast_path" ]] ||
    fail "Existing Foundry broadcast evidence blocks a new deployment. Reconcile it; never rerun blindly."
  [[ "$existing_manifest_status" == "not-deployed" ]] ||
    fail "Existing public deployment evidence blocks a new deployment. Review and archive it before any intentional replacement."
else
  [[ -f "$broadcast_path" ]] ||
    fail "Recovery requires the original Foundry run-latest.json broadcast artifact."
  if [[ "$operation" == "resume" && "$existing_manifest_status" != "broadcast-partial" ]]; then
    fail "Resume is allowed only for an exact broadcast-partial manifest, never a complete or conflicting deployment."
  fi
  if [[ "$operation" == "verify" && "$existing_manifest_status" != "broadcast-complete" ]]; then
    fail "Verification is allowed only after the manifest records broadcast-complete."
  fi
  if [[ -n "$existing_manifest_source_commit" ]]; then
    source_commit="$existing_manifest_source_commit"
  elif [[ "$operation" == "reconcile" ]] &&
    [[ "${DEPLOYMENT_SOURCE_COMMIT_OVERRIDE:-}" =~ ^[0-9a-fA-F]{40}$ ]]; then
    source_commit="$DEPLOYMENT_SOURCE_COMMIT_OVERRIDE"
  elif [[ "$operation" == "reconcile" ]]; then
    fail "Reconciliation without an existing source SHA requires DEPLOYMENT_SOURCE_COMMIT_OVERRIDE with the reviewed deployment commit."
  else
    fail "Resume and verification require a reconciled public manifest with the reviewed broadcast source SHA."
  fi
  if [[ "$operation" != "reconcile" ]]; then
    [[ -n "$existing_manifest_evidence_tooling_commit" ]] ||
      fail "Resume and verification require a reconciled public manifest with the reviewed evidence tooling SHA."
    evidence_tooling_commit="$existing_manifest_evidence_tooling_commit"
  fi
fi

if [[ "$operation" == "reconcile" ]]; then
  case "$existing_manifest_broadcast_sha256" in
    none)
      [[ "$existing_manifest_status" == "not-deployed" ]] ||
        fail "Only an exact not-deployed manifest may establish the first broadcast artifact digest."
      ;;
    invalid)
      fail "Reconciliation requires a valid committed broadcast artifact SHA-256 or the exact not-deployed placeholder."
      ;;
    *)
      current_broadcast_sha256="$(
        node -e '
          const crypto = require("node:crypto");
          const fs = require("node:fs");
          const bytes = fs.readFileSync(process.argv[1]);
          process.stdout.write(crypto.createHash("sha256").update(bytes).digest("hex"));
        ' "$broadcast_path"
      )"
      [[ "$current_broadcast_sha256" == "$existing_manifest_broadcast_sha256" ]] ||
        fail "Reconciliation refuses to replace the committed broadcast artifact SHA-256; restore the original run-latest.json."
      ;;
  esac
fi

node "$reviewed_worktree_checker" \
  "$repository_root" \
  "$source_commit" \
  "${broadcast_source_paths[@]}" ||
  fail "Broadcast-critical source must exactly match its reviewed commit, without hidden index flags, untracked files, or dirty nested dependencies."
node "$reviewed_worktree_checker" \
  "$repository_root" \
  "$evidence_tooling_commit" \
  "${evidence_tooling_paths[@]}" ||
  fail "Deployment and evidence tooling must exactly match its reviewed commit, without hidden index flags or untracked files."

if ! (
  cd "$contracts_dir"
  forge config --json
) | node -e '
  let input = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => {
    input += chunk;
  });
  process.stdin.on("end", () => {
    let config;
    try {
      config = JSON.parse(input);
    } catch {
      process.exit(1);
    }
    const exact = (actual, expected) =>
      JSON.stringify(actual) === JSON.stringify(expected);
    const valid =
      config.src === "src" &&
      config.script === "script" &&
      config.out === "out" &&
      exact(config.libs, ["lib"]) &&
      exact(config.remappings, [
        "@openzeppelin/contracts/=lib/openzeppelin-contracts/contracts/",
        "forge-std/=lib/forge-std/src/",
      ]) &&
      typeof config.auto_detect_remappings === "boolean" &&
      exact(config.libraries, []) &&
      exact(config.include_paths, []) &&
      exact(config.allow_paths, []) &&
      exact(config.skip, []) &&
      config.cache_path === "cache" &&
      config.broadcast === "broadcast" &&
      config.build_info_path === null &&
      config.test_failures_file === "cache/test-failures" &&
      config.fuzz?.failure_persist_dir === "cache/fuzz" &&
      config.fuzz?.corpus_dir === null &&
      config.invariant?.failure_persist_dir === "cache/invariant" &&
      config.invariant?.corpus_dir === null &&
      config.network === null &&
      config.celo === false &&
      config.hardfork === null &&
      config.fork_block_number === null &&
      config.chain_id === null &&
      config.isolate === false &&
      config.script_execution_protection === true &&
      config.solc === "0.8.28" &&
      config.evm_version === "cancun" &&
      config.optimizer === true &&
      config.optimizer_runs === 20000 &&
      config.optimizer_details === null &&
      config.via_ir === true &&
      config.bytecode_hash === "none" &&
      config.cbor_metadata === false &&
      config.revert_strings === null &&
      config.sparse_mode === false &&
      config.ffi === false &&
      config.always_use_create_2_factory === false &&
      config.use_literal_content === false &&
      exact(config.additional_compiler_profiles, []) &&
      exact(config.compilation_restrictions, []);
    if (!valid) process.exit(1);
  });
'; then
  fail "Effective Foundry deployment configuration differs from the reviewed profile."
fi

deployment_scope_dirty_evidence=""
full_tree_dirty_evidence=""
if [[ "$operation" == "reconcile" ]]; then
  case "$existing_manifest_scope_dirty" in
    null) deployment_scope_dirty_evidence="false" ;;
    true | false) deployment_scope_dirty_evidence="$existing_manifest_scope_dirty" ;;
    *) fail "Reconciliation requires deploymentScopeDirty to be true, false, or null." ;;
  esac
else
  deployment_scope_dirty_evidence="false"
  full_tree_dirty_evidence="false"
  full_tree_status="$(reviewed_git -C "$repository_root" status --porcelain --untracked-files=all)"
  [[ -n "$full_tree_status" ]] && full_tree_dirty_evidence="true"
fi

giwa_rpc_url="${GIWA_RPC_URL:-https://sepolia-rpc.giwa.io}"
actual_chain_id="$(ETH_RPC_URL="$giwa_rpc_url" cast chain-id)"
[[ "$actual_chain_id" == "$expected_chain_id" ]] ||
  fail "Refusing to continue: configured RPC reported chain ID $actual_chain_id, expected $expected_chain_id."

actual_genesis_hash="$(ETH_RPC_URL="$giwa_rpc_url" cast block 0 --field hash)"
[[ "$(lowercase "$actual_genesis_hash")" == "$expected_genesis_hash" ]] ||
  fail "Refusing to continue: chain ID matches but the genesis block is not the reviewed GIWA Sepolia genesis."

require_nonzero_address() {
  local variable_name="$1"
  local value="${!variable_name:-}"
  if [[ ! "$value" =~ ^0x[0-9a-fA-F]{40}$ ]] ||
    [[ "$value" == "0x0000000000000000000000000000000000000000" ]]; then
    fail "$variable_name must be an explicit nonzero EVM address."
  fi
}

validate_boolean() {
  local variable_name="$1"
  local value="${!variable_name:-}"
  [[ "$value" == "true" || "$value" == "false" ]] ||
    fail "$variable_name must be explicitly set to true or false."
}

deployer_balance_wei=""
if [[ "$operation" != "reconcile" ]]; then
  [[ "${CONFIRM_GIWA_SEPOLIA_DEPLOY:-$expected_chain_id}" == "$expected_chain_id" ]] ||
    fail "CONFIRM_GIWA_SEPOLIA_DEPLOY must equal $expected_chain_id."
  require_nonzero_address PLATFORM_FEE_RECIPIENT
  require_nonzero_address ADAPTER_MANAGER_ADDRESS

  [[ "${PLATFORM_FEE_BPS:-}" =~ ^[0-9]+$ ]] ||
    fail "PLATFORM_FEE_BPS must be explicitly set to an integer from 0 through 10000."
  normalized_fee_bps="${PLATFORM_FEE_BPS#"${PLATFORM_FEE_BPS%%[!0]*}"}"
  [[ -n "$normalized_fee_bps" ]] || normalized_fee_bps="0"
  [[ "${#normalized_fee_bps}" -le 5 ]] &&
    ((10#$normalized_fee_bps <= 10000)) ||
    fail "PLATFORM_FEE_BPS must be no greater than 10000."
  validate_boolean PRODUCTION_MODE
  validate_boolean DEPLOY_TEST_MOCKS
  if [[ "$PRODUCTION_MODE" == "true" && "$DEPLOY_TEST_MOCKS" == "true" ]]; then
    fail "Test mocks cannot be deployed with PRODUCTION_MODE=true."
  fi

  if [[ "$operation" == "verify" ]]; then
    require_nonzero_address DEPLOYER_ADDRESS
  else
    [[ -n "${GIWAPAY_DEPLOYER_ACCOUNT:-}" ]] ||
      fail "GIWAPAY_DEPLOYER_ACCOUNT must name an existing encrypted Foundry keystore account."
    export DEPLOYER_ADDRESS
    DEPLOYER_ADDRESS="$(cast wallet address --account "$GIWAPAY_DEPLOYER_ACCOUNT")"
  fi
  require_nonzero_address DEPLOYER_ADDRESS
  if [[ "$DEPLOY_TEST_MOCKS" == "true" ]] &&
    [[ "$(lowercase "$DEPLOYER_ADDRESS")" != "$(lowercase "$ADAPTER_MANAGER_ADDRESS")" ]]; then
    fail "A labelled mock deployment requires the deployer to be the adapter manager."
  fi

  if [[ "$operation" != "verify" ]]; then
    deployer_balance_wei="$(ETH_RPC_URL="$giwa_rpc_url" cast balance "$DEPLOYER_ADDRESS")"
    [[ "$deployer_balance_wei" =~ ^[0-9]+$ ]] ||
      fail "Could not obtain a numeric deployer balance."
    echo "Preflight deployer address: $DEPLOYER_ADDRESS"
    echo "Preflight deployer balance (wei): $deployer_balance_wei"
    balance_without_leading_zeroes="${deployer_balance_wei#"${deployer_balance_wei%%[!0]*}"}"
    [[ -n "$balance_without_leading_zeroes" ]] ||
      fail "The selected deployer has no GIWA Sepolia ETH. Fund it and re-run preflight."
  fi
fi

validate_recovery_manifest() {
  local expected_status="$1"
  node -e '
    const crypto = require("node:crypto");
    const fs = require("node:fs");
    const [
      manifestPath,
      broadcastPath,
      sourceCommit,
      evidenceToolingCommit,
      expectedStatus,
    ] = process.argv.slice(1);
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    const broadcast = fs.readFileSync(broadcastPath);
    const broadcastJson = JSON.parse(broadcast.toString("utf8"));
    const digest = crypto.createHash("sha256").update(broadcast).digest("hex");
    const embeddedCommit =
      typeof broadcastJson.commit === "string" &&
      /^[0-9a-fA-F]{7,40}$/.test(broadcastJson.commit)
        ? broadcastJson.commit.toLowerCase()
        : null;
    const reviewedCommit = sourceCommit.toLowerCase();
    const sameAddress = (left, right) =>
      typeof left === "string" && typeof right === "string" &&
      left.toLowerCase() === right.toLowerCase();
    const failures = [];
    if (manifest.schemaVersion !== 2) failures.push("manifest schema");
    if (manifest.chainId !== 91342 || manifest.mode !== "giwa-sepolia") {
      failures.push("manifest network");
    }
    if (Number(broadcastJson.chain) !== 91342) failures.push("broadcast network");
    if (manifest.deploymentScopeDirty !== false) failures.push("reviewed deployment scope");
    if (manifest.deploymentStatus !== expectedStatus) failures.push("deployment status");
    if ((manifest.sourceCommit ?? "").toLowerCase() !== sourceCommit.toLowerCase()) {
      failures.push("source SHA");
    }
    if (
      (manifest.evidenceToolingCommit ?? "").toLowerCase() !==
      evidenceToolingCommit.toLowerCase()
    ) {
      failures.push("evidence tooling SHA");
    }
    if (manifest.broadcastArtifact?.sha256 !== digest) failures.push("broadcast SHA-256");
    if (embeddedCommit === null || !reviewedCommit.startsWith(embeddedCommit)) {
      failures.push("embedded broadcast source SHA");
    }
    if ((manifest.broadcastArtifact?.sourceCommit ?? "").toLowerCase() !== embeddedCommit) {
      failures.push("manifest broadcast source SHA");
    }
    if (!sameAddress(manifest.configuration?.deployerAddress, process.env.DEPLOYER_ADDRESS)) {
      failures.push("deployer address");
    }
    if (!sameAddress(
      manifest.configuration?.adapterManagerAddress,
      process.env.ADAPTER_MANAGER_ADDRESS,
    )) failures.push("adapter manager");
    if (!sameAddress(
      manifest.configuration?.platformFeeRecipient,
      process.env.PLATFORM_FEE_RECIPIENT,
    )) failures.push("platform fee recipient");
    if (manifest.configuration?.platformFeeBps !== Number(process.env.PLATFORM_FEE_BPS)) {
      failures.push("platform fee bps");
    }
    if (manifest.configuration?.productionMode !== (process.env.PRODUCTION_MODE === "true")) {
      failures.push("production mode");
    }
    if (manifest.configuration?.deployTestMocks !== (process.env.DEPLOY_TEST_MOCKS === "true")) {
      failures.push("mock mode");
    }
    if (!Array.isArray(manifest.configurationConflicts) ||
        manifest.configurationConflicts.length > 0) failures.push("recorded configuration conflict");
    if (failures.length > 0) {
      process.stderr.write(`Recovery evidence mismatch: ${failures.join(", ")}\n`);
      process.exit(1);
    }
  ' \
    "$manifest_path" \
    "$broadcast_path" \
    "$source_commit" \
    "$evidence_tooling_commit" \
    "$expected_status" ||
    fail "Recovery preflight rejected the manifest or broadcast artifact before Forge was invoked."
}

if [[ "$operation" == "resume" ]]; then
  validate_recovery_manifest "broadcast-partial"
elif [[ "$operation" == "verify" ]]; then
  validate_recovery_manifest "broadcast-complete"
fi

run_extractor() {
  local verification_requested_value="${1:-}"
  DEPLOYMENT_SOURCE_COMMIT="$source_commit" \
    DEPLOYMENT_EVIDENCE_TOOLING_COMMIT="$evidence_tooling_commit" \
    DEPLOYMENT_RPC_URL="$giwa_rpc_url" \
    DEPLOYMENT_EXPLORER_BASE_URL="${GIWA_EXPLORER_URL:-https://sepolia-explorer.giwa.io}" \
    DEPLOYMENT_VERIFIER_URL="${GIWA_EXPLORER_API_URL:-https://sepolia-explorer.giwa.io/api}" \
    DEPLOYMENT_VERIFICATION_REQUESTED="$verification_requested_value" \
    DEPLOYMENT_QUERY_ONCHAIN_CONFIGURATION=true \
    DEPLOYMENT_SCOPE_DIRTY="$deployment_scope_dirty_evidence" \
    DEPLOYMENT_FULL_TREE_DIRTY="$full_tree_dirty_evidence" \
    DEPLOYER_ADDRESS="${DEPLOYER_ADDRESS:-}" \
    ADAPTER_MANAGER_ADDRESS="${ADAPTER_MANAGER_ADDRESS:-}" \
    PLATFORM_FEE_RECIPIENT="${PLATFORM_FEE_RECIPIENT:-}" \
    PLATFORM_FEE_BPS="${PLATFORM_FEE_BPS:-}" \
    PRODUCTION_MODE="${PRODUCTION_MODE:-}" \
    DEPLOY_TEST_MOCKS="${DEPLOY_TEST_MOCKS:-}" \
    DEPLOYER_BALANCE_WEI="$deployer_balance_wei" \
    node "$repository_root/scripts/extract-deployment.mjs" \
    "$broadcast_path" \
    "$manifest_path" \
    "$expected_chain_id" \
    giwa-sepolia \
    --public
}

read_manifest_field() {
  local field="$1"
  node -e '
    const fs = require("node:fs");
    const [path, field] = process.argv.slice(1);
    const manifest = JSON.parse(fs.readFileSync(path, "utf8"));
    const value = field.split(".").reduce((cursor, key) => cursor?.[key], manifest);
    if (typeof value === "string") process.stdout.write(value);
  ' "$manifest_path" "$field"
}

if [[ "$operation" == "reconcile" ]]; then
  reconcile_verification_requested="${RECONCILE_VERIFICATION_REQUESTED:-}"
  if [[ -n "$reconcile_verification_requested" ]]; then
    [[ "$reconcile_verification_requested" == "true" || "$reconcile_verification_requested" == "false" ]] ||
      fail "RECONCILE_VERIFICATION_REQUESTED must be true or false when set."
  fi
  run_extractor "$reconcile_verification_requested" ||
    fail "Reconciliation could not refresh the public manifest. The private broadcast artifact was not modified."
  echo "Reconciliation completed without broadcasting. Review $manifest_path."
  exit 0
fi

if [[ "$operation" != "verify" ]]; then
  forge_arguments=(
    script/DeployGiwaSepolia.s.sol:DeployGiwaSepolia
    --account "$GIWAPAY_DEPLOYER_ACCOUNT"
    --broadcast
    --force
    --rpc-url "$giwa_rpc_url"
  )
  if [[ "$operation" == "resume" ]]; then
    forge_arguments+=(--resume)
  fi

  set +e
  (
    cd "$contracts_dir"
    ETH_RPC_URL="$giwa_rpc_url" forge script "${forge_arguments[@]}"
  )
  broadcast_exit_code=$?
  set -e

  if [[ -f "$broadcast_path" ]]; then
    run_extractor "" ||
      fail "The broadcast artifact was preserved, but public evidence extraction failed. Do not rerun; repair the extractor and reconcile."
  fi

  if ((broadcast_exit_code != 0)); then
    fail "Broadcast did not complete. Existing evidence was preserved when available. Inspect it, then reconcile or explicitly resume; do not start a new deployment."
  fi
  [[ -f "$manifest_path" ]] || fail "Broadcast returned success but no public evidence manifest was produced."
  [[ "$(read_manifest_field deploymentStatus)" == "broadcast-complete" ]] ||
    fail "Broadcast evidence is incomplete. Reconcile it before any verification or retry."
fi

verification_targets="$(
  node -e '
    const fs = require("node:fs");
    const manifest = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    const address = /^0x[0-9a-fA-F]{40}$/;
    const hash = /^0x[0-9a-fA-F]{64}$/;
    if (!Array.isArray(manifest.deployments) || manifest.deployments.length === 0) {
      process.exit(1);
    }
    for (const entry of manifest.deployments) {
      if (typeof entry.contractName !== "string" ||
          !address.test(entry.address ?? "") ||
          !hash.test(entry.transactionHash ?? "")) {
        process.exit(1);
      }
      process.stdout.write(`${entry.contractName}\t${entry.address}\t${entry.transactionHash}\n`);
    }
  ' "$manifest_path"
)" || fail "The public manifest does not contain valid per-contract verification targets."

verification_exit_code=0
while IFS=$'\t' read -r contract_name contract_address transaction_hash; do
  case "$contract_name" in
    MerchantRegistry)
      contract_identifier="src/MerchantRegistry.sol:MerchantRegistry"
      ;;
    AdapterRegistry)
      contract_identifier="src/AdapterRegistry.sol:AdapterRegistry"
      ;;
    PaymentRouter)
      contract_identifier="src/PaymentRouter.sol:PaymentRouter"
      ;;
    MockKRW)
      contract_identifier="src/mocks/MockKRW.sol:MockKRW"
      ;;
    MockUSDC)
      contract_identifier="src/mocks/MockUSDC.sol:MockUSDC"
      ;;
    MockALT)
      contract_identifier="src/mocks/MockALT.sol:MockALT"
      ;;
    MockTokenFaucet)
      contract_identifier="src/mocks/MockTokenFaucet.sol:MockTokenFaucet"
      ;;
    MockFixedRateExactOutputAdapter)
      contract_identifier="src/mocks/MockFixedRateExactOutputAdapter.sol:MockFixedRateExactOutputAdapter"
      ;;
    *)
      fail "Manifest contains an unsupported contract name: $contract_name"
      ;;
  esac

  set +e
  (
    cd "$contracts_dir"
    ETH_RPC_URL="$giwa_rpc_url" \
      VERIFIER_URL="${GIWA_EXPLORER_API_URL:-https://sepolia-explorer.giwa.io/api}" \
      forge verify-contract \
      "$contract_address" \
      "$contract_identifier" \
      --chain "$expected_chain_id" \
      --rpc-url "$giwa_rpc_url" \
      --verifier blockscout \
      --verifier-url "${GIWA_EXPLORER_API_URL:-https://sepolia-explorer.giwa.io/api}" \
      --guess-constructor-args \
      --creation-transaction-hash "$transaction_hash" \
      --watch
  )
  verification_exit_code=$?
  set -e
  if ((verification_exit_code != 0)); then
    break
  fi
done <<<"$verification_targets"

run_extractor true ||
  fail "Verification returned, but public evidence refresh failed. The broadcast artifact remains the recovery source; do not redeploy."
if ((verification_exit_code != 0)); then
  fail "The broadcast evidence is preserved, but the verification command failed. Do not redeploy; reconcile and retry verification explicitly."
fi

manifest_verification_status="$(read_manifest_field verification.status)"
if [[ "$manifest_verification_status" != "verified" ]]; then
  fail "Verification was submitted but the explorer has not confirmed every contract. The manifest records status '$manifest_verification_status'; reconcile after indexing."
fi

manifest_readiness="$(
  node -e '
    const fs = require("node:fs");
    const manifest = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    const queries = manifest.onChainConfiguration;
    const comparisons = queries?.matchesExpected ?? {};
    const runtimeConfirmed = Array.isArray(manifest.deployments) &&
      manifest.deployments.length > 0 &&
      manifest.deployments.every((entry) => entry.runtimeCodeStatus === "confirmed");
    const configurationConfirmed =
      queries?.status === "confirmed" &&
      queries?.adapterRegistry?.configuredManagerEnabled === true &&
      manifest.configuration?.deployTestMocks === false &&
      manifest.mockReadiness?.status === "not-applicable" &&
      manifest.deploymentScopeDirty === false &&
      Array.isArray(manifest.configurationConflicts) &&
      manifest.configurationConflicts.length === 0 &&
      [
        "deployerOwnsRouter",
        "deployerOwnsAdapterRegistry",
        "feeRecipient",
        "feeBps",
        "productionMode",
        "registryReferences",
      ].every((key) => comparisons[key] === true);
    process.stdout.write(runtimeConfirmed && configurationConfirmed ? "ready" : "review-required");
  ' "$manifest_path"
)"
[[ "$manifest_readiness" == "ready" ]] ||
  fail "Explorer verification is confirmed, but runtime code hashes or on-chain role/fee checks remain unavailable or mismatched. Review the manifest before any application configuration."

echo "GIWA Sepolia broadcast and explorer verification are recorded in $manifest_path. Review every address, role, fee, code hash, and source commit before configuring services."
