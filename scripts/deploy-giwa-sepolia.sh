#!/usr/bin/env bash
set -euo pipefail

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
contracts_dir="$repository_root/packages/contracts"
broadcast_dir="$contracts_dir/broadcast/DeployGiwaSepolia.s.sol/91342"
legacy_broadcast_path="$broadcast_dir/run-latest.json"
broadcast_path="$legacy_broadcast_path"
recovery_sidecar_path=""
manifest_path="$repository_root/deployments/giwa-sepolia/current.json"
manifest_relative_path="deployments/giwa-sepolia/current.json"
expected_chain_id="91342"
expected_genesis_hash="0xca1b5fee64a196abfca007b3a4d4e3ec2b37be83a452d452bf4e45937004cab2"
expected_forge_version="1.7.1"
expected_forge_commit="4072e48705af9d93e3c0f6e29e93b5e9a40caed8"
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
  scripts/capture-deployment-transition.mjs
  package.json
  pnpm-lock.yaml
)
sealed_repository_root=""
sealed_repository_realpath=""
sealed_temp_parent_realpath=""
deployment_lock_path=""
deployment_lock_token=""
deployment_lock_acquired="false"

cleanup_runtime_state() {
  if [[ -n "$sealed_repository_root" && -d "$sealed_repository_root" ]]; then
    if [[ -n "${inflight_guard_path:-}" &&
      (-e "$inflight_guard_path" || -L "$inflight_guard_path") ]]; then
      echo "Preserved unresolved isolated deployment workspace: $sealed_repository_root" >&2
    elif [[ -n "$sealed_repository_realpath" &&
      "$sealed_repository_root" == "$sealed_repository_realpath" &&
      -n "$sealed_temp_parent_realpath" &&
      "$(dirname "$sealed_repository_root")" == "$sealed_temp_parent_realpath" &&
      "$(basename "$sealed_repository_root")" == giwapay-reviewed-deploy.* ]]; then
      rm -rf -- "$sealed_repository_root"
    else
      echo "Refusing unsafe isolated workspace cleanup: $sealed_repository_root" >&2
    fi
  fi
  if [[ "$deployment_lock_acquired" == "true" &&
    -n "$deployment_lock_path" &&
    -n "$deployment_lock_token" &&
    (-e "$deployment_lock_path" || -L "$deployment_lock_path") ]]; then
    node -e '
      const fs = require("node:fs");
      const path = require("node:path");
      const [ownerPath, expectedToken] = process.argv.slice(1);
      const stats = fs.lstatSync(ownerPath);
      if (!stats.isFile() || stats.isSymbolicLink()) process.exit(1);
      const owner = JSON.parse(fs.readFileSync(ownerPath, "utf8"));
      if (owner.token !== expectedToken) process.exit(1);
      fs.unlinkSync(ownerPath);
      const directoryDescriptor = fs.openSync(path.dirname(ownerPath), "r");
      try {
        fs.fsyncSync(directoryDescriptor);
      } finally {
        fs.closeSync(directoryDescriptor);
      }
    ' "$deployment_lock_path" "$deployment_lock_token" ||
      echo "Deployment lock ownership changed; the lock was preserved for review." >&2
  fi
}
trap cleanup_runtime_state EXIT

fail() {
  echo "$*" >&2
  exit 1
}

lowercase() {
  printf '%s' "$1" | tr '[:upper:]' '[:lower:]'
}

publish_sealed_manifest() {
  local published_sha256
  published_sha256="$(
    node -e '
      const crypto = require("node:crypto");
      const fs = require("node:fs");
      const path = require("node:path");
      const [source, destination, expectedDigest] = process.argv.slice(1);
      const digest = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");
      const sourceStats = fs.lstatSync(source);
      const destinationStats = fs.lstatSync(destination);
      if (
        !sourceStats.isFile() ||
        sourceStats.isSymbolicLink() ||
        !destinationStats.isFile() ||
        destinationStats.isSymbolicLink()
      ) {
        process.exit(1);
      }
      const currentBytes = fs.readFileSync(destination);
      if (digest(currentBytes) !== expectedDigest) process.exit(2);
      const nextBytes = fs.readFileSync(source);
      const temporaryPath = path.join(
        path.dirname(destination),
        `.${path.basename(destination)}.${process.pid}.${crypto.randomUUID()}.tmp`,
      );
      let descriptor;
      try {
        descriptor = fs.openSync(temporaryPath, "wx", 0o644);
        fs.writeFileSync(descriptor, nextBytes);
        fs.fsyncSync(descriptor);
        fs.closeSync(descriptor);
        descriptor = undefined;
        if (digest(fs.readFileSync(destination)) !== expectedDigest) process.exit(3);
        fs.renameSync(temporaryPath, destination);
        const directoryDescriptor = fs.openSync(path.dirname(destination), "r");
        try {
          fs.fsyncSync(directoryDescriptor);
        } finally {
          fs.closeSync(directoryDescriptor);
        }
      } finally {
        if (descriptor !== undefined) fs.closeSync(descriptor);
        try {
          fs.rmSync(temporaryPath);
        } catch (error) {
          if (error?.code !== "ENOENT") throw error;
        }
      }
      process.stdout.write(digest(nextBytes));
    ' "$sealed_manifest_path" "$manifest_path" "$canonical_manifest_expected_sha256"
  )" || fail "The public manifest changed concurrently; isolated evidence was preserved without overwriting it."
  canonical_manifest_expected_sha256="$published_sha256"
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

for executable in forge cast node git mktemp; do
  if ! command -v "$executable" >/dev/null 2>&1; then
    fail "Required executable is unavailable: $executable"
  fi
done
forge_identity="$(forge --version)"
node -e '
  const [identity, expectedVersion, expectedCommit] = process.argv.slice(1);
  const lines = identity.split(/\r?\n/);
  if (
    lines[0] !== `forge Version: ${expectedVersion}` ||
    lines[1] !== `Commit SHA: ${expectedCommit}`
  ) process.exit(1);
' "$forge_identity" "$expected_forge_version" "$expected_forge_commit" ||
  fail "Forge must be the reviewed $expected_forge_version build ($expected_forge_commit) before deployment or resume."
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

git_common_dir_value="$(reviewed_git -C "$repository_root" rev-parse --git-common-dir)"
deployment_lock_path="$(
  node -e '
    const fs = require("node:fs");
    const path = require("node:path");
    const [root, commonValue] = process.argv.slice(1);
    const commonPath = path.resolve(root, commonValue);
    const stats = fs.lstatSync(commonPath);
    if (!stats.isDirectory() || stats.isSymbolicLink()) process.exit(1);
    process.stdout.write(path.join(fs.realpathSync(commonPath), "giwapay-deployment.lock"));
  ' "$repository_root" "$git_common_dir_value"
)" || fail "Could not resolve the shared Git directory for the deployment lock."
git_common_dir_realpath="$(dirname "$deployment_lock_path")"
umask 077
shared_evidence_root="$git_common_dir_realpath/giwapay-deployment-evidence/$expected_chain_id"
canonical_broadcast_dir="$shared_evidence_root/broadcast"
canonical_recovery_cache_dir="$shared_evidence_root/cache"
deployment_lock_token="$(node -e 'process.stdout.write(require("node:crypto").randomUUID())')"
node -e '
  const fs = require("node:fs");
  const path = require("node:path");
  const [commonRoot, ownerPath, token, operation, wrapperPidValue] =
    process.argv.slice(1);
  const stagingPath = path.join(commonRoot, `.giwapay-deployment-lock.${token}.tmp`);
  const wrapperPid = Number(wrapperPidValue);
  if (
    path.dirname(ownerPath) !== commonRoot ||
    path.basename(ownerPath) !== "giwapay-deployment.lock" ||
    !Number.isSafeInteger(wrapperPid) ||
    wrapperPid <= 0
  ) process.exit(1);
  const payload = {
    schemaVersion: 1,
    token,
    pid: wrapperPid,
    operation,
    startedAt: new Date().toISOString(),
  };
  let descriptor;
  try {
    descriptor = fs.openSync(stagingPath, "wx", 0o600);
    fs.writeFileSync(descriptor, `${JSON.stringify(payload, null, 2)}\n`);
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;
    fs.linkSync(stagingPath, ownerPath);
    const directoryDescriptor = fs.openSync(commonRoot, "r");
    try {
      fs.fsyncSync(directoryDescriptor);
    } finally {
      fs.closeSync(directoryDescriptor);
    }
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
    try {
      fs.unlinkSync(stagingPath);
      const directoryDescriptor = fs.openSync(commonRoot, "r");
      try {
        fs.fsyncSync(directoryDescriptor);
      } finally {
        fs.closeSync(directoryDescriptor);
      }
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
' "$git_common_dir_realpath" "$deployment_lock_path" "$deployment_lock_token" "$operation" "$$" ||
  fail "Another deployment or recovery process holds the shared repository lock. If it crashed, inspect the durable lock owner and on-chain account state; never delete it automatically."
deployment_lock_acquired="true"
export GIWAPAY_WRAPPER_PID="$$"

node -e '
  const fs = require("node:fs");
  const path = require("node:path");
  const [rootValue, ...directories] = process.argv.slice(1);
  const root = fs.realpathSync(path.resolve(rootValue));
  for (const directoryValue of directories) {
    const directory = path.resolve(directoryValue);
    const relative = path.relative(root, directory);
    if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`)) {
      process.exit(1);
    }
    let cursor = root;
    for (const component of relative.split(path.sep)) {
      const parent = cursor;
      cursor = path.join(cursor, component);
      if (!fs.existsSync(cursor)) {
        fs.mkdirSync(cursor, { mode: 0o700 });
        const parentDescriptor = fs.openSync(parent, "r");
        try {
          fs.fsyncSync(parentDescriptor);
        } finally {
          fs.closeSync(parentDescriptor);
        }
      }
      const stats = fs.lstatSync(cursor);
      if (
        !stats.isDirectory() ||
        stats.isSymbolicLink() ||
        (stats.mode & 0o077) !== 0
      ) process.exit(1);
    }
  }
' "$git_common_dir_realpath" "$canonical_broadcast_dir" "$canonical_recovery_cache_dir" ||
  fail "Shared deployment evidence directories must remain private real directories inside the Git common directory."

inflight_guard_path="$git_common_dir_realpath/giwapay-deployment-91342-inflight.json"
inflight_guard_present="false"
if [[ -e "$inflight_guard_path" || -L "$inflight_guard_path" ]]; then
  inflight_guard_present="true"
fi
if [[ "$operation" == "deploy" || "$operation" == "resume" ]]; then
  [[ "$inflight_guard_present" == "false" ]] ||
    fail "An unresolved deployment attempt guard blocks signing. Inspect its sealed workspace and recover evidence before any rebroadcast."
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
existing_manifest_broadcast_file_name="$(
  node -e '
    const fs = require("node:fs");
    const path = process.argv[1];
    try {
      const manifest = JSON.parse(fs.readFileSync(path, "utf8"));
      if (!Object.hasOwn(manifest, "broadcastArtifact")) {
        process.stdout.write("none");
      } else {
        const fileName = manifest.broadcastArtifact?.fileName;
        process.stdout.write(
          fileName === "run-latest.json" || /^run-[0-9a-fA-F]{64}\.json$/.test(fileName ?? "")
            ? fileName
            : "invalid",
        );
      }
    } catch {
      process.stdout.write("invalid");
    }
  ' "$manifest_path"
)"
existing_manifest_resume_authorized="$(
  node -e '
    const fs = require("node:fs");
    const path = process.argv[1];
    try {
      const artifact = JSON.parse(fs.readFileSync(path, "utf8")).broadcastArtifact;
      if (artifact === undefined) {
        process.stdout.write("none");
      } else if (artifact.resumeAuthorized === true) {
        process.stdout.write("true");
      } else if (artifact.resumeAuthorized === false || artifact.resumeAuthorized === undefined) {
        process.stdout.write("false");
      } else {
        process.stdout.write("invalid");
      }
    } catch {
      process.stdout.write("invalid");
    }
  ' "$manifest_path"
)"
existing_manifest_recovery_sidecar="$(
  node -e '
    const fs = require("node:fs");
    try {
      const reference = JSON.parse(
        fs.readFileSync(process.argv[1], "utf8"),
      ).broadcastArtifact?.recoverySidecar;
      if (reference === undefined) {
        process.stdout.write(JSON.stringify({ state: "none" }));
      } else if (
        /^run-[0-9a-f]{64}\.json$/.test(reference.fileName ?? "") &&
        /^[0-9a-f]{64}$/.test(reference.sha256 ?? "") &&
        reference.fileName === `run-${reference.sha256}.json` &&
        /^[0-9a-f]{64}$/.test(reference.publicArtifactSha256 ?? "") &&
        /^[0-9a-f]{64}$/.test(reference.rpcUrlSha256 ?? "") &&
        reference.storage === "foundry-cache-private"
      ) {
        process.stdout.write(JSON.stringify({
          state: "valid",
          fileName: reference.fileName,
          sha256: reference.sha256,
          publicArtifactSha256: reference.publicArtifactSha256,
          rpcUrlSha256: reference.rpcUrlSha256,
        }));
      } else {
        process.stdout.write(JSON.stringify({ state: "invalid" }));
      }
    } catch {
      process.stdout.write(JSON.stringify({ state: "invalid" }));
    }
  ' "$manifest_path"
)"
existing_manifest_recovery_sidecar_state="$(
  node -e 'process.stdout.write(JSON.parse(process.argv[1]).state)' \
    "$existing_manifest_recovery_sidecar"
)"
existing_manifest_has_transition_provenance="$(
  node -e '
    const fs = require("node:fs");
    try {
      const artifact = JSON.parse(
        fs.readFileSync(process.argv[1], "utf8"),
      ).broadcastArtifact;
      process.stdout.write(
        artifact?.recoverySidecar &&
        artifact?.resumePolicy &&
        artifact?.transitionJournal
          ? "true"
          : "false",
      );
    } catch {
      process.stdout.write("false");
    }
  ' "$manifest_path"
)"
current_resume_authorized="false"
if [[ "$existing_manifest_resume_authorized" == "true" ]]; then
  current_resume_authorized="true"
fi
recovered_first_artifact=""

if [[ "$operation" == "deploy" ]]; then
  broadcast_evidence_exists="$(
    node -e '
      const fs = require("node:fs");
      for (const directory of process.argv.slice(1)) {
        try {
          const entries = fs.readdirSync(directory, { withFileTypes: true });
          if (entries.some((entry) => /^run-.*\.json$/.test(entry.name))) {
            process.stdout.write("true");
            process.exit(0);
          }
        } catch (error) {
          if (error?.code !== "ENOENT") throw error;
        }
      }
      process.stdout.write("false");
    ' "$broadcast_dir" "$canonical_broadcast_dir"
  )"
  [[ "$broadcast_evidence_exists" == "false" ]] ||
    fail "Existing Foundry broadcast evidence blocks a new deployment. Reconcile it; never rerun blindly."
  [[ "$existing_manifest_status" == "not-deployed" ]] ||
    fail "Existing public deployment evidence blocks a new deployment. Review and archive it before any intentional replacement."
else
  if [[ "$existing_manifest_broadcast_sha256" == "none" ]]; then
    if [[ "$operation" == "reconcile" && "$inflight_guard_present" == "true" ]]; then
      recovered_first_artifact="guard-pending"
      broadcast_path=""
    else
      recovered_first_artifact="$(
      node -e '
        const fs = require("node:fs");
        const path = require("node:path");
        const directory = process.argv[1];
        let entries;
        try {
          entries = fs.readdirSync(directory, { withFileTypes: true });
        } catch (error) {
          if (error?.code === "ENOENT") {
            process.stdout.write("none");
            process.exit(0);
          }
          throw error;
        }
        const candidates = entries.filter((entry) =>
          entry.name === "run-latest.json" || /^run-[0-9a-fA-F]{64}\.json$/.test(entry.name),
        );
        if (candidates.some((entry) => !entry.isFile())) {
          process.stdout.write("invalid");
        } else if (candidates.length === 1) {
          process.stdout.write(candidates[0].name);
        } else {
          process.stdout.write(candidates.length === 0 ? "none" : "ambiguous");
        }
      ' "$broadcast_dir"
      )"
      [[ "$recovered_first_artifact" != "none" &&
        "$recovered_first_artifact" != "invalid" &&
        "$recovered_first_artifact" != "ambiguous" ]] ||
        fail "Recovery without a committed artifact digest requires exactly one regular Foundry broadcast artifact."
      broadcast_path="$broadcast_dir/$recovered_first_artifact"
    fi
  else
    [[ "$existing_manifest_broadcast_file_name" != "invalid" &&
      "$existing_manifest_broadcast_file_name" != "none" ]] ||
      fail "Recovery requires a safe committed broadcast artifact file name."
    if [[ "$existing_manifest_broadcast_file_name" != "run-latest.json" &&
      "$existing_manifest_broadcast_file_name" != "run-$existing_manifest_broadcast_sha256.json" ]]; then
      fail "The committed content-addressed broadcast file name must match its SHA-256."
    fi
    if [[ "$existing_manifest_resume_authorized" == "true" &&
      "$existing_manifest_broadcast_file_name" != "run-$existing_manifest_broadcast_sha256.json" ]]; then
      fail "Resume authorization requires a content-addressed broadcast artifact."
    fi
    if [[ "$existing_manifest_broadcast_file_name" == "run-latest.json" ]]; then
      broadcast_path="$legacy_broadcast_path"
    else
      broadcast_path="$canonical_broadcast_dir/$existing_manifest_broadcast_file_name"
    fi
  fi
  if [[ "$existing_manifest_recovery_sidecar_state" == "valid" ]]; then
    recorded_sidecar_file_name="$(
      node -e 'process.stdout.write(JSON.parse(process.argv[1]).fileName)' \
        "$existing_manifest_recovery_sidecar"
    )"
    recorded_sidecar_public_sha256="$(
      node -e 'process.stdout.write(JSON.parse(process.argv[1]).publicArtifactSha256)' \
        "$existing_manifest_recovery_sidecar"
    )"
    [[ "$recorded_sidecar_public_sha256" == "$existing_manifest_broadcast_sha256" ]] ||
      fail "The private recovery sidecar is bound to another public artifact digest."
    recorded_sidecar_rpc_url_sha256="$(
      node -e 'process.stdout.write(JSON.parse(process.argv[1]).rpcUrlSha256)' \
        "$existing_manifest_recovery_sidecar"
    )"
    recovery_sidecar_path="$canonical_recovery_cache_dir/$recorded_sidecar_file_name"
    [[ -f "$recovery_sidecar_path" && ! -L "$recovery_sidecar_path" ]] ||
      fail "Recovery requires the exact private content-addressed Foundry cache sidecar."
  elif [[ "$existing_manifest_recovery_sidecar_state" == "invalid" ]]; then
    fail "The committed private recovery sidecar reference is malformed."
  fi
  if [[ "$recovered_first_artifact" != "guard-pending" ]]; then
    [[ -f "$broadcast_path" ]] ||
      fail "Recovery requires the exact recorded Foundry broadcast artifact."
  fi
  if [[ "$operation" == "resume" && "$existing_manifest_status" != "broadcast-partial" ]]; then
    fail "Resume is allowed only for an exact broadcast-partial manifest, never a complete or conflicting deployment."
  fi
  if [[ "$operation" == "resume" && "$existing_manifest_resume_authorized" != "true" ]]; then
    fail "Resume is not authorized for a first-digest or legacy reconciled artifact; only a sealed wrapper-generated partial artifact may sign pending transactions."
  fi
  if [[ "$operation" == "resume" && -z "$recovery_sidecar_path" ]]; then
    fail "Resume authorization requires the exact private content-addressed Foundry cache sidecar."
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

umask 077
sealed_temp_parent_realpath="$(
  node -e '
    const fs = require("node:fs");
    const path = require("node:path");
    const candidate = path.resolve(process.argv[1]);
    const stats = fs.lstatSync(candidate);
    if (!stats.isDirectory() || stats.isSymbolicLink()) process.exit(1);
    process.stdout.write(fs.realpathSync(candidate));
  ' "${TMPDIR:-/tmp}"
)" || fail "TMPDIR must resolve to a real directory for isolated deployment."
sealed_repository_root="$(mktemp -d "$sealed_temp_parent_realpath/giwapay-reviewed-deploy.XXXXXX")"
[[ -n "$sealed_repository_root" && -d "$sealed_repository_root" &&
  ! -L "$sealed_repository_root" ]] ||
  fail "Could not create an isolated reviewed deployment workspace."
sealed_repository_realpath="$(node -e 'process.stdout.write(require("node:fs").realpathSync(process.argv[1]))' "$sealed_repository_root")"
[[ "$sealed_repository_root" == "$sealed_repository_realpath" &&
  "$(dirname "$sealed_repository_root")" == "$sealed_temp_parent_realpath" &&
  "$(basename "$sealed_repository_root")" == giwapay-reviewed-deploy.* ]] ||
  fail "The isolated deployment workspace path failed its deletion-safety boundary."

bootstrap_checker_directory="$sealed_repository_root/.giwapay-bootstrap"
bootstrap_checker="$bootstrap_checker_directory/assert-reviewed-worktree.mjs"
mkdir -m 700 "$bootstrap_checker_directory"
reviewed_checker_entry="$(
  reviewed_git -C "$repository_root" ls-tree \
    "$evidence_tooling_commit" \
    -- \
    scripts/assert-reviewed-worktree.mjs
)" || fail "Could not resolve the reviewed worktree checker blob."
IFS=$' \t' read -r reviewed_checker_mode reviewed_checker_type reviewed_checker_object reviewed_checker_path <<<"$reviewed_checker_entry"
[[ ("$reviewed_checker_mode" == "100644" || "$reviewed_checker_mode" == "100755") &&
  "$reviewed_checker_type" == "blob" &&
  "$reviewed_checker_object" =~ ^[0-9a-fA-F]{40,64}$ &&
  "$reviewed_checker_path" == "scripts/assert-reviewed-worktree.mjs" ]] ||
  fail "The reviewed worktree checker must resolve to one exact regular Git blob."
reviewed_git -C "$repository_root" cat-file blob "$reviewed_checker_object" |
  node -e '
    const fs = require("node:fs");
    const path = process.argv[1];
    const chunks = [];
    process.stdin.on("data", (chunk) => chunks.push(chunk));
    process.stdin.on("end", () => {
      const descriptor = fs.openSync(path, "wx", 0o400);
      try {
        fs.writeFileSync(descriptor, Buffer.concat(chunks));
        fs.fsyncSync(descriptor);
      } finally {
        fs.closeSync(descriptor);
      }
    });
  ' "$bootstrap_checker" ||
  fail "Could not bootstrap the reviewed worktree checker from its immutable Git blob."
node --check "$bootstrap_checker" >/dev/null ||
  fail "The immutable reviewed worktree checker is not valid JavaScript."
node "$bootstrap_checker" \
  "$repository_root" \
  "$evidence_tooling_commit" \
  --materialize "$sealed_repository_root" \
  "${evidence_tooling_paths[@]}" ||
  fail "Deployment and evidence tooling must exactly match and materialize from its reviewed commit, without hidden index flags or untracked files."
sealed_worktree_checker="$sealed_repository_root/scripts/assert-reviewed-worktree.mjs"
node --check "$sealed_worktree_checker" >/dev/null
node --check "$sealed_repository_root/scripts/extract-deployment.mjs" >/dev/null
node --check "$sealed_repository_root/scripts/capture-deployment-transition.mjs" >/dev/null
rm -- "$bootstrap_checker"
rmdir "$bootstrap_checker_directory"
node "$sealed_worktree_checker" \
  "$repository_root" \
  "$source_commit" \
  --materialize "$sealed_repository_root" \
  "${broadcast_source_paths[@]}" ||
  fail "Broadcast-critical source must exactly match and materialize from its reviewed commit, without hidden index flags, untracked files, or dirty nested dependencies."

reviewed_git -C "$sealed_repository_root" init --quiet
reviewed_git -C "$sealed_repository_root" fetch \
  --quiet \
  --no-tags \
  "$repository_root" \
  "$source_commit"
reviewed_git -C "$sealed_repository_root" update-ref \
  refs/heads/reviewed-source \
  "$source_commit"
reviewed_git -C "$sealed_repository_root" symbolic-ref \
  HEAD \
  refs/heads/reviewed-source
sealed_source_commit="$(reviewed_git -C "$sealed_repository_root" rev-parse HEAD)"
[[ "$(lowercase "$sealed_source_commit")" == "$(lowercase "$source_commit")" ]] ||
  fail "The isolated deployment workspace could not preserve the reviewed source identity."

sealed_contracts_dir="$sealed_repository_root/packages/contracts"
sealed_broadcast_dir="$sealed_contracts_dir/broadcast/DeployGiwaSepolia.s.sol/$expected_chain_id"
sealed_recovery_cache_dir="$sealed_contracts_dir/cache/DeployGiwaSepolia.s.sol/$expected_chain_id"
sealed_evidence_dir="$sealed_repository_root/.giwapay-evidence"
sealed_manifest_path="$sealed_repository_root/$manifest_relative_path"
mkdir -p \
  "$(dirname "$sealed_manifest_path")" \
  "$sealed_broadcast_dir" \
  "$sealed_recovery_cache_dir" \
  "$sealed_evidence_dir"
canonical_manifest_expected_sha256="$(
  node -e '
    const crypto = require("node:crypto");
    const fs = require("node:fs");
    const [source, destination] = process.argv.slice(1);
    const stats = fs.lstatSync(source);
    if (!stats.isFile() || stats.isSymbolicLink()) process.exit(1);
    const bytes = fs.readFileSync(source);
    fs.writeFileSync(destination, bytes, { flag: "wx", mode: 0o600 });
    process.stdout.write(crypto.createHash("sha256").update(bytes).digest("hex"));
  ' "$manifest_path" "$sealed_manifest_path"
)" || fail "The reviewed manifest could not be captured in the isolated workspace."
sealed_manifest_blob="$(
  reviewed_git -C "$repository_root" hash-object --no-filters "$sealed_manifest_path"
)"
[[ "$(lowercase "$sealed_manifest_blob")" == "$(lowercase "$manifest_head_blob")" ]] ||
  fail "The captured manifest no longer matches the reviewed HEAD blob."

sealed_broadcast_path=""
sealed_recovery_sidecar_path=""
if [[ "$operation" != "deploy" && "$recovered_first_artifact" != "guard-pending" ]]; then
  sealed_broadcast_path="$sealed_evidence_dir/$(basename "$broadcast_path")"
  captured_broadcast_sha256="$(
    node -e '
      const crypto = require("node:crypto");
      const fs = require("node:fs");
      const [source, destination] = process.argv.slice(1);
      const stats = fs.lstatSync(source);
      if (!stats.isFile() || stats.isSymbolicLink()) process.exit(1);
      const bytes = fs.readFileSync(source);
      fs.writeFileSync(destination, bytes, { flag: "wx", mode: 0o600 });
      process.stdout.write(crypto.createHash("sha256").update(bytes).digest("hex"));
    ' "$broadcast_path" "$sealed_broadcast_path"
  )" || fail "The recovery artifact could not be captured as a regular-file snapshot."
  if [[ -n "$recovery_sidecar_path" ]]; then
    mkdir -p "$sealed_evidence_dir/private"
    sealed_recovery_sidecar_path="$sealed_evidence_dir/private/$(basename "$recovery_sidecar_path")"
    captured_recovery_sidecar_sha256="$(
      node -e '
        const crypto = require("node:crypto");
        const fs = require("node:fs");
        const [source, destination] = process.argv.slice(1);
        const stats = fs.lstatSync(source);
        if (!stats.isFile() || stats.isSymbolicLink()) process.exit(1);
        const bytes = fs.readFileSync(source);
        fs.writeFileSync(destination, bytes, { flag: "wx", mode: 0o600 });
        process.stdout.write(crypto.createHash("sha256").update(bytes).digest("hex"));
      ' "$recovery_sidecar_path" "$sealed_recovery_sidecar_path"
    )" || fail "The private recovery sidecar could not be captured as a regular-file snapshot."
    recorded_sidecar_sha256="$(
      node -e 'process.stdout.write(JSON.parse(process.argv[1]).sha256)' \
        "$existing_manifest_recovery_sidecar"
    )"
    [[ "$captured_recovery_sidecar_sha256" == "$recorded_sidecar_sha256" ]] ||
      fail "The private recovery sidecar differs from its committed SHA-256."
  fi
fi

if [[ "$operation" == "reconcile" && "$recovered_first_artifact" != "guard-pending" ]]; then
  case "$existing_manifest_broadcast_sha256" in
    none)
      [[ "$existing_manifest_status" == "not-deployed" ]] ||
        fail "Only an exact not-deployed manifest may establish the first broadcast artifact digest."
      ;;
    invalid)
      fail "Reconciliation requires a valid committed broadcast artifact SHA-256 or the exact not-deployed placeholder."
      ;;
    *)
      [[ "$captured_broadcast_sha256" == "$existing_manifest_broadcast_sha256" ]] ||
        fail "Reconciliation refuses to replace the committed broadcast artifact SHA-256; restore the exact recorded artifact."
      ;;
  esac
elif [[ "$operation" != "deploy" && "$recovered_first_artifact" != "guard-pending" ]]; then
  [[ "$captured_broadcast_sha256" == "$existing_manifest_broadcast_sha256" ]] ||
    fail "Recovery refuses a broadcast artifact that differs from the committed SHA-256."
fi

if [[ "$operation" == "reconcile" && "$inflight_guard_present" == "true" ]]; then
  preserved_guard_metadata="$(
    node -e '
      const crypto = require("node:crypto");
      const fs = require("node:fs");
      const path = require("node:path");
      const guard = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
      if (
        guard.operation !== "deploy" && guard.operation !== "resume" ||
        typeof guard.attemptToken !== "string" ||
        typeof guard.sealedWorkspace !== "string"
      ) process.exit(1);
      const outputPath = path.join(
        guard.sealedWorkspace,
        "packages/contracts/broadcast/DeployGiwaSepolia.s.sol/91342/run-latest.json",
      );
      const cachePath = path.join(
        guard.sealedWorkspace,
        "packages/contracts/cache/DeployGiwaSepolia.s.sol/91342/run-latest.json",
      );
      const fileState = (candidate) => {
        try {
          const stats = fs.lstatSync(candidate);
          return stats.isFile() && !stats.isSymbolicLink() ? "regular" : "invalid";
        } catch (error) {
          if (error?.code === "ENOENT") return "missing";
          throw error;
        }
      };
      const outputFileState = fileState(outputPath);
      const cacheFileState = fileState(cachePath);
      const outputState =
        outputFileState === "regular" && cacheFileState === "regular"
          ? "complete"
          : outputFileState === "missing" && cacheFileState === "missing"
            ? "absent"
            : "invalid";
      const outputSha256 =
        outputState === "complete"
          ? crypto.createHash("sha256").update(fs.readFileSync(outputPath)).digest("hex")
          : null;
      const outputRecoverySidecarSha256 =
        outputState === "complete"
          ? crypto.createHash("sha256").update(fs.readFileSync(cachePath)).digest("hex")
          : null;
      process.stdout.write(JSON.stringify({
        operation: guard.operation,
        attemptToken: guard.attemptToken,
        inputArtifactSha256: guard.inputArtifactSha256,
        inputRecoverySidecarSha256: guard.inputRecoverySidecarSha256,
        outputState,
        outputSha256,
        outputRecoverySidecarSha256,
        sealedWorkspace: guard.sealedWorkspace,
        signingEvidenceToolingCommit:
          guard.signingEvidenceToolingCommit,
        fullTreeDirty: guard.fullTreeDirty,
        configuration: guard.configuration,
      }));
    ' "$inflight_guard_path"
  )" || fail "The unresolved deployment attempt guard is malformed."
  preserved_operation="$(
    node -e 'process.stdout.write(JSON.parse(process.argv[1]).operation)' \
      "$preserved_guard_metadata"
  )"
  preserved_attempt_token="$(
    node -e 'process.stdout.write(JSON.parse(process.argv[1]).attemptToken)' \
      "$preserved_guard_metadata"
  )"
  preserved_input_sha256="$(
    node -e '
      const value = JSON.parse(process.argv[1]).inputArtifactSha256;
      process.stdout.write(value === null ? "none" : value);
    ' "$preserved_guard_metadata"
  )"
  preserved_input_sidecar_sha256="$(
    node -e '
      const value = JSON.parse(process.argv[1]).inputRecoverySidecarSha256;
      process.stdout.write(value === null ? "none" : value);
    ' "$preserved_guard_metadata"
  )"
  preserved_output_state="$(
    node -e 'process.stdout.write(JSON.parse(process.argv[1]).outputState)' \
      "$preserved_guard_metadata"
  )"
  preserved_output_sha256="none"
  preserved_output_sidecar_sha256="none"
  if [[ "$preserved_output_state" == "complete" ]]; then
    preserved_output_sha256="$(
      node -e 'process.stdout.write(JSON.parse(process.argv[1]).outputSha256)' \
        "$preserved_guard_metadata"
    )"
    preserved_output_sidecar_sha256="$(
      node -e 'process.stdout.write(JSON.parse(process.argv[1]).outputRecoverySidecarSha256)' \
        "$preserved_guard_metadata"
    )"
  elif [[ "$preserved_output_state" == "invalid" ]]; then
    fail "The guarded Forge workspace contains an incomplete or unsafe public/private output pair. Inspect it without signing."
  fi
  preserved_workspace="$(
    node -e 'process.stdout.write(JSON.parse(process.argv[1]).sealedWorkspace)' \
      "$preserved_guard_metadata"
  )"
  preserved_full_tree_dirty="$(
    node -e 'process.stdout.write(String(JSON.parse(process.argv[1]).fullTreeDirty))' \
      "$preserved_guard_metadata"
  )"
  if [[ "$preserved_output_state" == "complete" &&
    "$preserved_operation" == "resume" &&
    "$preserved_input_sha256" == "$preserved_output_sha256" ]]; then
    fail "The preserved resume attempt did not produce a distinct artifact transition. Inspect the account nonce and chain receipts before clearing the shared guard."
  fi
  clear_inflight_after_reconcile="false"
  committed_sidecar_sha256="none"
  if [[ "$existing_manifest_recovery_sidecar_state" == "valid" ]]; then
    committed_sidecar_sha256="$(
      node -e 'process.stdout.write(JSON.parse(process.argv[1]).sha256)' \
        "$existing_manifest_recovery_sidecar"
    )"
  fi
  if [[ "$preserved_output_state" == "absent" ]]; then
    [[ "$existing_manifest_has_transition_provenance" == "true" &&
      "$existing_manifest_broadcast_sha256" != "none" &&
      "$existing_manifest_broadcast_sha256" != "invalid" &&
      "$committed_sidecar_sha256" != "none" ]] ||
      fail "The guarded Forge attempt has no complete sealed output pair or committed transition. Reconcile the deployer nonce and receipts before any explicit operator recovery."
    clear_inflight_after_reconcile="true"
  elif [[ "$existing_manifest_broadcast_sha256" == "$preserved_output_sha256" &&
    "$committed_sidecar_sha256" == "$preserved_output_sidecar_sha256" &&
    "$existing_manifest_has_transition_provenance" == "true" ]]; then
    clear_inflight_after_reconcile="true"
  else
    preserved_previous_artifact="-"
    preserved_previous_sidecar="-"
    if [[ "$preserved_operation" == "resume" ]]; then
      preserved_previous_artifact="$canonical_broadcast_dir/run-$preserved_input_sha256.json"
      preserved_previous_sidecar="$canonical_recovery_cache_dir/run-$preserved_input_sidecar_sha256.json"
      [[ -f "$preserved_previous_artifact" &&
        ! -L "$preserved_previous_artifact" &&
        -f "$preserved_previous_sidecar" &&
        ! -L "$preserved_previous_sidecar" ]] ||
        fail "Interrupted resume recovery requires both exact content-addressed predecessor artifacts."
    fi
    recovery_manifest_path="$preserved_workspace/.giwapay-evidence/recovery-manifest-$deployment_lock_token.json"
    recovery_evidence_dir="$preserved_workspace/.giwapay-evidence/recovery-$deployment_lock_token"
    mkdir -p "$(dirname "$recovery_manifest_path")" "$recovery_evidence_dir"
    node -e '
      const fs = require("node:fs");
      const [source, destination] = process.argv.slice(1);
      const bytes = fs.readFileSync(source);
      fs.writeFileSync(destination, bytes, { flag: "wx", mode: 0o600 });
    ' "$sealed_manifest_path" "$recovery_manifest_path" ||
      fail "Could not stage the committed manifest inside the preserved Forge workspace."
    preserved_configuration="$(
      node -e 'process.stdout.write(JSON.stringify(JSON.parse(process.argv[1]).configuration))' \
        "$preserved_guard_metadata"
    )"
    recovered_transition_result="$(
      DEPLOYER_ADDRESS="$(
        node -e 'process.stdout.write(JSON.parse(process.argv[1]).deployerAddress)' \
          "$preserved_configuration"
      )" \
      ADAPTER_MANAGER_ADDRESS="$(
        node -e 'process.stdout.write(JSON.parse(process.argv[1]).adapterManagerAddress)' \
          "$preserved_configuration"
      )" \
      PLATFORM_FEE_RECIPIENT="$(
        node -e 'process.stdout.write(JSON.parse(process.argv[1]).platformFeeRecipient)' \
          "$preserved_configuration"
      )" \
      PLATFORM_FEE_BPS="$(
        node -e 'process.stdout.write(String(JSON.parse(process.argv[1]).platformFeeBps))' \
          "$preserved_configuration"
      )" \
      PRODUCTION_MODE="$(
        node -e 'process.stdout.write(String(JSON.parse(process.argv[1]).productionMode))' \
          "$preserved_configuration"
      )" \
      DEPLOY_TEST_MOCKS="$(
        node -e 'process.stdout.write(String(JSON.parse(process.argv[1]).deployTestMocks))' \
          "$preserved_configuration"
      )" \
      node "$sealed_repository_root/scripts/capture-deployment-transition.mjs" \
        capture \
        "$recovery_manifest_path" \
        "$preserved_workspace/packages/contracts/broadcast/DeployGiwaSepolia.s.sol/$expected_chain_id/run-latest.json" \
        "$preserved_workspace/packages/contracts/cache/DeployGiwaSepolia.s.sol/$expected_chain_id/run-latest.json" \
        "$preserved_previous_artifact" \
        "$preserved_previous_sidecar" \
        "$git_common_dir_realpath" \
        "$canonical_broadcast_dir" \
        "$canonical_recovery_cache_dir" \
        "$recovery_evidence_dir" \
        "$inflight_guard_path" \
        "$preserved_operation" \
        255 \
        "$source_commit" \
        "$evidence_tooling_commit" \
        "$preserved_full_tree_dirty"
    )" ||
      fail "The preserved Forge workspace could not be converted into a reviewed transition. Inspect the guard and on-chain account state; do not rebroadcast."
    recovered_transition_changed="$(
      node -e '
        const result = JSON.parse(process.argv[1]);
        process.stdout.write(result.changed === true ? "true" : "false");
      ' "$recovered_transition_result"
    )"
    [[ "$recovered_transition_changed" == "true" ]] ||
      fail "The preserved Forge output contains no monotonic artifact transition; the in-flight guard remains unresolved."
    sealed_manifest_path="$recovery_manifest_path"
    publish_sealed_manifest
    echo "Recovered the interrupted Forge output without signing. Commit and review $manifest_path, then run reconciliation again."
    exit 0
  fi
fi

if ! (
  cd "$sealed_contracts_dir"
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
giwa_rpc_url_sha256="$(
  node -e '
    process.stdout.write(
      require("node:crypto")
        .createHash("sha256")
        .update(process.argv[1])
        .digest("hex"),
    );
  ' "$giwa_rpc_url"
)"
if [[ "$operation" == "resume" ]]; then
  [[ "${recorded_sidecar_rpc_url_sha256:-}" == "$giwa_rpc_url_sha256" ]] ||
    fail "Resume must use the exact RPC endpoint bound to the private Foundry cache sidecar."
fi
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
  local require_resume_authorization="${2:-false}"
  node -e '
    const crypto = require("node:crypto");
    const fs = require("node:fs");
    const path = require("node:path");
    const [
      manifestPath,
      broadcastPath,
      sourceCommit,
      evidenceToolingCommit,
      expectedStatus,
      requireResumeAuthorization,
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
    if (manifest.broadcastArtifact?.fileName !== path.basename(broadcastPath)) {
      failures.push("broadcast artifact file name");
    }
    if (
      requireResumeAuthorization === "true" &&
      manifest.broadcastArtifact?.resumeAuthorized !== true
    ) {
      failures.push("resume authorization provenance");
    }
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
    "$sealed_manifest_path" \
    "$sealed_broadcast_path" \
    "$source_commit" \
    "$evidence_tooling_commit" \
    "$expected_status" \
    "$require_resume_authorization" ||
    fail "Recovery preflight rejected the manifest or broadcast artifact before Forge was invoked."
}

if [[ "$operation" == "resume" ]]; then
  validate_recovery_manifest "broadcast-partial" "true"
elif [[ "$operation" == "verify" ]]; then
  validate_recovery_manifest "broadcast-complete"
fi

sealed_forge_broadcast_path="$sealed_broadcast_dir/run-latest.json"
sealed_forge_recovery_sidecar_path="$sealed_recovery_cache_dir/run-latest.json"
if [[ "$operation" == "resume" && "$sealed_broadcast_path" != "$sealed_forge_broadcast_path" ]]; then
  node -e '
    const fs = require("node:fs");
    const [source, destination] = process.argv.slice(1);
    const bytes = fs.readFileSync(source);
    fs.writeFileSync(destination, bytes, { flag: "wx", mode: 0o600 });
  ' "$sealed_broadcast_path" "$sealed_forge_broadcast_path" ||
    fail "The authorized recovery artifact could not be staged for isolated resume."
fi
if [[ "$operation" == "resume" ]]; then
  [[ -n "$sealed_recovery_sidecar_path" ]] ||
    fail "The authorized private recovery sidecar is unavailable."
  node -e '
    const fs = require("node:fs");
    const [source, destination] = process.argv.slice(1);
    const bytes = fs.readFileSync(source);
    fs.writeFileSync(destination, bytes, { flag: "wx", mode: 0o600 });
  ' "$sealed_recovery_sidecar_path" "$sealed_forge_recovery_sidecar_path" ||
    fail "The authorized private recovery sidecar could not be staged for isolated resume."
  node "$sealed_repository_root/scripts/capture-deployment-transition.mjs" \
    validate \
    "$sealed_manifest_path" \
    "$sealed_broadcast_path" \
    "$sealed_recovery_sidecar_path" \
    "$git_common_dir_realpath" \
    "$canonical_broadcast_dir" \
    "$canonical_recovery_cache_dir" \
    "$giwa_rpc_url_sha256" >/dev/null ||
    fail "Resume requires a committed wrapper transition with matching public artifact, private cache sidecar, and journal."
fi
if [[ "$operation" == "verify" && "$existing_manifest_resume_authorized" == "true" ]]; then
  [[ -n "$sealed_recovery_sidecar_path" ]] ||
    fail "Verification cannot preserve resume authorization without its private recovery sidecar."
  node "$sealed_repository_root/scripts/capture-deployment-transition.mjs" \
    validate \
    "$sealed_manifest_path" \
    "$sealed_broadcast_path" \
    "$sealed_recovery_sidecar_path" \
    "$git_common_dir_realpath" \
    "$canonical_broadcast_dir" \
    "$canonical_recovery_cache_dir" \
    "$giwa_rpc_url_sha256" >/dev/null ||
    fail "Verification cannot preserve an invalid recovery provenance chain."
fi

run_extractor() {
  local verification_requested_value="${1:-}"
  local resume_authorized_value="${2:-$current_resume_authorized}"
  DEPLOYMENT_SOURCE_COMMIT="$source_commit" \
    DEPLOYMENT_EVIDENCE_TOOLING_COMMIT="$evidence_tooling_commit" \
    DEPLOYMENT_RPC_URL="$giwa_rpc_url" \
    DEPLOYMENT_EXPLORER_BASE_URL="${GIWA_EXPLORER_URL:-https://sepolia-explorer.giwa.io}" \
    DEPLOYMENT_VERIFIER_URL="${GIWA_EXPLORER_API_URL:-https://sepolia-explorer.giwa.io/api}" \
    DEPLOYMENT_VERIFICATION_REQUESTED="$verification_requested_value" \
    DEPLOYMENT_RESUME_AUTHORIZED="$resume_authorized_value" \
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
    node "$sealed_repository_root/scripts/extract-deployment.mjs" \
    "$sealed_broadcast_path" \
    "$sealed_manifest_path" \
    "$expected_chain_id" \
    giwa-sepolia \
    --public || return 1
  publish_sealed_manifest
}

read_manifest_field() {
  local field="$1"
  node -e '
    const fs = require("node:fs");
    const [path, field] = process.argv.slice(1);
    const manifest = JSON.parse(fs.readFileSync(path, "utf8"));
    const value = field.split(".").reduce((cursor, key) => cursor?.[key], manifest);
    if (typeof value === "string") process.stdout.write(value);
  ' "$sealed_manifest_path" "$field"
}

if [[ "$operation" == "reconcile" ]]; then
  reconcile_verification_requested="${RECONCILE_VERIFICATION_REQUESTED:-}"
  if [[ -n "$reconcile_verification_requested" ]]; then
    [[ "$reconcile_verification_requested" == "true" || "$reconcile_verification_requested" == "false" ]] ||
      fail "RECONCILE_VERIFICATION_REQUESTED must be true or false when set."
  fi
  reconcile_resume_authorized="false"
  case "$existing_manifest_resume_authorized" in
    true) reconcile_resume_authorized="true" ;;
    false | none) ;;
    *) fail "Reconciliation requires a boolean resume authorization state." ;;
  esac
  if [[ "$existing_manifest_status" == "broadcast-transition" ||
    "$existing_manifest_resume_authorized" == "true" ||
    "$existing_manifest_has_transition_provenance" == "true" ]]; then
    [[ -n "$sealed_recovery_sidecar_path" ]] ||
      fail "The committed transition is missing its private recovery sidecar."
    node "$sealed_repository_root/scripts/capture-deployment-transition.mjs" \
      validate \
      "$sealed_manifest_path" \
      "$sealed_broadcast_path" \
      "$sealed_recovery_sidecar_path" \
      "$git_common_dir_realpath" \
      "$canonical_broadcast_dir" \
      "$canonical_recovery_cache_dir" \
      "$giwa_rpc_url_sha256" >/dev/null ||
      fail "The committed transition journal does not authorize this recovered artifact."
    reconcile_resume_authorized="true"
  fi
  current_resume_authorized="$reconcile_resume_authorized"
  run_extractor "$reconcile_verification_requested" "$reconcile_resume_authorized" ||
    fail "Reconciliation could not refresh the public manifest. The private broadcast artifact was not modified."
  if [[ "${clear_inflight_after_reconcile:-false}" == "true" ]]; then
    node "$sealed_repository_root/scripts/capture-deployment-transition.mjs" \
      complete \
      "$inflight_guard_path" \
      "$preserved_attempt_token" ||
      fail "Reconciliation succeeded, but the shared in-flight guard could not be closed."
  fi
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

  inflight_input_sha256="none"
  inflight_input_sidecar_sha256="none"
  if [[ "$operation" == "resume" ]]; then
    inflight_input_sha256="$existing_manifest_broadcast_sha256"
    inflight_input_sidecar_sha256="$recorded_sidecar_sha256"
  fi
  inflight_guard_path="$(
    DEPLOYER_ADDRESS="${DEPLOYER_ADDRESS:-}" \
    ADAPTER_MANAGER_ADDRESS="${ADAPTER_MANAGER_ADDRESS:-}" \
    PLATFORM_FEE_RECIPIENT="${PLATFORM_FEE_RECIPIENT:-}" \
    PLATFORM_FEE_BPS="${PLATFORM_FEE_BPS:-}" \
    PRODUCTION_MODE="${PRODUCTION_MODE:-}" \
    DEPLOY_TEST_MOCKS="${DEPLOY_TEST_MOCKS:-}" \
    node "$sealed_repository_root/scripts/capture-deployment-transition.mjs" \
      begin \
      "$git_common_dir_realpath" \
      "$canonical_broadcast_dir" \
      "$canonical_recovery_cache_dir" \
      "$inflight_guard_path" \
      "$deployment_lock_token" \
      "$operation" \
      "$source_commit" \
      "$evidence_tooling_commit" \
      "$inflight_input_sha256" \
      "$inflight_input_sidecar_sha256" \
      "$sealed_repository_root" \
      "$full_tree_dirty_evidence" \
      "$giwa_rpc_url_sha256"
  )" || fail "Could not durably record the in-flight deployment guard before signing."

  set +e
  (
    cd "$sealed_contracts_dir"
    ETH_RPC_URL="$giwa_rpc_url" forge script "${forge_arguments[@]}"
  )
  broadcast_exit_code=$?
  set -e

  if [[ -f "$sealed_forge_broadcast_path" &&
    -f "$sealed_forge_recovery_sidecar_path" ]]; then
    previous_transition_artifact="-"
    previous_transition_sidecar="-"
    if [[ "$operation" == "resume" ]]; then
      previous_transition_artifact="$sealed_broadcast_path"
      previous_transition_sidecar="$sealed_recovery_sidecar_path"
    fi
    transition_result="$(
      DEPLOYER_ADDRESS="${DEPLOYER_ADDRESS:-}" \
      ADAPTER_MANAGER_ADDRESS="${ADAPTER_MANAGER_ADDRESS:-}" \
      PLATFORM_FEE_RECIPIENT="${PLATFORM_FEE_RECIPIENT:-}" \
      PLATFORM_FEE_BPS="${PLATFORM_FEE_BPS:-}" \
      PRODUCTION_MODE="${PRODUCTION_MODE:-}" \
      DEPLOY_TEST_MOCKS="${DEPLOY_TEST_MOCKS:-}" \
      node "$sealed_repository_root/scripts/capture-deployment-transition.mjs" \
      capture \
      "$sealed_manifest_path" \
      "$sealed_forge_broadcast_path" \
      "$sealed_forge_recovery_sidecar_path" \
      "$previous_transition_artifact" \
      "$previous_transition_sidecar" \
      "$git_common_dir_realpath" \
      "$canonical_broadcast_dir" \
      "$canonical_recovery_cache_dir" \
      "$sealed_evidence_dir" \
      "$inflight_guard_path" \
      "$operation" \
      "$broadcast_exit_code" \
      "$source_commit" \
      "$evidence_tooling_commit" \
      "$full_tree_dirty_evidence"
    )" ||
      fail "Forge returned broadcast evidence, but its isolated transition could not be durably captured. Do not rerun."
    transition_changed="$(
      node -e '
        const result = JSON.parse(process.argv[1]);
        process.stdout.write(result.changed === true ? "true" : "false");
      ' "$transition_result"
    )"
    if [[ "$transition_changed" != "true" ]]; then
      fail "The Forge attempt produced no distinct public/private recovery transition. Inspect the account nonce and chain receipts before clearing the shared guard."
    fi
    sealed_broadcast_path="$(
        node -e '
          const result = JSON.parse(process.argv[1]);
          if (typeof result.sealedArtifactPath !== "string") process.exit(1);
          process.stdout.write(result.sealedArtifactPath);
        ' "$transition_result"
    )"
    sealed_recovery_sidecar_path="$(
        node -e '
          const result = JSON.parse(process.argv[1]);
          if (typeof result.sealedRecoverySidecarPath !== "string") process.exit(1);
          process.stdout.write(result.sealedRecoverySidecarPath);
        ' "$transition_result"
    )"
    publish_sealed_manifest
    fail "Forge evidence was sealed without authorizing another signature. Review and commit the transition manifest, then reconcile it before verification or resume."
  fi

  if ((broadcast_exit_code != 0)); then
    fail "Broadcast did not complete. Existing evidence was preserved when available. Inspect it, then reconcile or explicitly resume; do not start a new deployment."
  fi
  [[ -f "$sealed_manifest_path" ]] ||
    fail "Broadcast returned success but no public evidence manifest was produced."
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
  ' "$sealed_manifest_path"
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
    cd "$sealed_contracts_dir"
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

run_extractor true "$current_resume_authorized" ||
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
  ' "$sealed_manifest_path"
)"
[[ "$manifest_readiness" == "ready" ]] ||
  fail "Explorer verification is confirmed, but runtime code hashes or on-chain role/fee checks remain unavailable or mismatched. Review the manifest before any application configuration."

echo "GIWA Sepolia broadcast and explorer verification are recorded in $manifest_path. Review every address, role, fee, code hash, and source commit before configuring services."
