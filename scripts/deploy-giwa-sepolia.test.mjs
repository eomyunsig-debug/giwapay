import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import test from 'node:test';

const execFileAsync = promisify(execFile);
const scriptsDirectory = dirname(fileURLToPath(import.meta.url));
const nodeBinaryDirectory = dirname(process.execPath);
const sourceCommit = '1234567890abcdef1234567890abcdef12345678';
const toolingCommit = 'abcdef1234567890abcdef1234567890abcdef12';
const checkerBlob = '4444444444444444444444444444444444444444';
const manifestBlob = '7777777777777777777777777777777777777777';
const deployer = '0x4444444444444444444444444444444444444444';
const adapterManager = '0x5555555555555555555555555555555555555555';
const feeRecipient = '0x6666666666666666666666666666666666666666';
const merchantRegistry = '0x1111111111111111111111111111111111111111';
const adapterRegistry = '0x2222222222222222222222222222222222222222';
const paymentRouter = '0x3333333333333333333333333333333333333333';
const gitRedirectEnvironmentNames = new Set([
  'GIT_DIR',
  'GIT_WORK_TREE',
  'GIT_INDEX_FILE',
  'GIT_COMMON_DIR',
  'GIT_OBJECT_DIRECTORY',
  'GIT_ALTERNATE_OBJECT_DIRECTORIES',
  'GIT_REPLACE_REF_BASE',
  'GIT_NAMESPACE',
  'GIT_SHALLOW_FILE',
  'GIT_CONFIG_COUNT',
  'GIT_CONFIG_PARAMETERS',
  'GIT_CONFIG_GLOBAL',
  'GIT_CONFIG_SYSTEM',
]);
const inheritedEnvironment = Object.fromEntries(
  Object.entries(process.env).filter(
    ([name]) =>
      !name.startsWith('FOUNDRY_') &&
      !name.startsWith('DAPP_') &&
      !gitRedirectEnvironmentNames.has(name) &&
      !name.startsWith('GIT_CONFIG_KEY_') &&
      !name.startsWith('GIT_CONFIG_VALUE_'),
  ),
);

async function createHarness(
  context,
  { status = 'broadcast-complete', useRealTransitionHelper = false } = {},
) {
  const root = await mkdtemp(join(tmpdir(), 'giwapay-wrapper-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  const scriptDirectory = join(root, 'scripts');
  const contractsDirectory = join(root, 'packages', 'contracts');
  const broadcastDirectory = join(
    contractsDirectory,
    'broadcast',
    'DeployGiwaSepolia.s.sol',
    '91342',
  );
  const deploymentDirectory = join(root, 'deployments', 'giwa-sepolia');
  const fakeBin = join(root, 'fake-bin');
  await Promise.all([
    mkdir(scriptDirectory, { recursive: true }),
    mkdir(broadcastDirectory, { recursive: true }),
    mkdir(deploymentDirectory, { recursive: true }),
    mkdir(fakeBin, { recursive: true }),
    mkdir(join(root, '.git'), { recursive: true }),
    mkdir(join(root, 'tmp'), { recursive: true }),
  ]);

  const wrapper = join(scriptDirectory, 'deploy-giwa-sepolia.sh');
  const reviewedCheckerFixture = join(root, '.reviewed-assert-reviewed-worktree.mjs');
  await copyFile(join(scriptsDirectory, 'deploy-giwa-sepolia.sh'), wrapper);
  await copyFile(
    join(scriptsDirectory, 'extract-deployment.mjs'),
    join(scriptDirectory, 'extract-deployment.mjs'),
  );
  await writeFile(
    join(scriptDirectory, 'assert-reviewed-worktree.mjs'),
    `import fs from 'node:fs';
import path from 'node:path';
const [root, commit, marker, destination, ...reviewedPaths] = process.argv.slice(2);
if (marker !== '--materialize' || !root || !commit || !destination) process.exit(2);
const sourceScope = reviewedPaths.some((entry) =>
  entry === '.env' || entry.startsWith('packages/contracts'),
);
const toolingScope = reviewedPaths.some((entry) => entry.startsWith('scripts/'));
if (sourceScope && process.env.FAKE_HIDDEN_INDEX_STATE === 'true') {
  process.stderr.write('special Git index state is not allowed\\n');
  process.exit(1);
}
if (sourceScope && process.env.FAKE_IGNORED_UNTRACKED === 'true') {
  process.stderr.write('reviewed scope contains an untracked file, including an ignored file\\n');
  process.exit(1);
}
if (
  (sourceScope && (
    process.env.FAKE_SOURCE_COMMIT_EXISTS === 'false' ||
    process.env.FAKE_SOURCE_TREE_MATCHES === 'false' ||
    process.env.FAKE_BROADCAST_TREE_MATCHES === 'false' ||
    process.env.FAKE_DEPLOYMENT_SCOPE_DIRTY === 'true'
  )) ||
  (toolingScope && process.env.FAKE_TOOLING_TREE_MATCHES === 'false')
) process.exit(1);
for (const reviewedPath of reviewedPaths) {
  const source = path.join(root, reviewedPath);
  if (!fs.existsSync(source)) continue;
  const target = path.join(destination, reviewedPath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.cpSync(source, target, { recursive: true, errorOnExist: true, force: false });
}
`,
  );
  await copyFile(join(scriptDirectory, 'assert-reviewed-worktree.mjs'), reviewedCheckerFixture);
  if (useRealTransitionHelper) {
    await copyFile(
      join(scriptsDirectory, 'capture-deployment-transition.mjs'),
      join(scriptDirectory, 'capture-deployment-transition.mjs'),
    );
  } else {
    await writeFile(
      join(scriptDirectory, 'capture-deployment-transition.mjs'),
      `import fs from 'node:fs';
import path from 'node:path';
const [command, ...values] = process.argv.slice(2);
if (command === 'begin') {
  const guardPath = values[3];
  const guard = {
    schemaVersion: 1,
    project: 'GiwaPay',
    chainId: 91342,
    attemptToken: values[4],
    operation: values[5],
    sourceCommit: values[6],
    signingEvidenceToolingCommit: values[7],
    inputArtifactSha256: values[8] === 'none' ? null : values[8],
    inputRecoverySidecarSha256: values[9] === 'none' ? null : values[9],
    sealedWorkspace: values[10],
    fullTreeDirty: values[11] === 'true',
    expectedRpcUrlSha256: values[12],
    configuration: {
      deployerAddress: process.env.DEPLOYER_ADDRESS,
      adapterManagerAddress: process.env.ADAPTER_MANAGER_ADDRESS,
      platformFeeRecipient: process.env.PLATFORM_FEE_RECIPIENT,
      platformFeeBps: Number(process.env.PLATFORM_FEE_BPS),
      productionMode: process.env.PRODUCTION_MODE === 'true',
      deployTestMocks: process.env.DEPLOY_TEST_MOCKS === 'true',
    },
  };
  fs.writeFileSync(guardPath, JSON.stringify(guard), { flag: 'wx', mode: 0o600 });
  process.stdout.write(guardPath);
} else if (command === 'validate') {
  process.stdout.write('true');
} else if (command === 'capture') {
  process.stdout.write(JSON.stringify({ changed: false }));
} else if (command === 'complete') {
  const guard = JSON.parse(fs.readFileSync(values[0], 'utf8'));
  if (guard.attemptToken !== values[1]) process.exit(1);
  fs.unlinkSync(values[0]);
} else {
  process.exit(2);
}
`,
    );
  }
  await chmod(wrapper, 0o755);

  const broadcast = {
    chain: 91342,
    commit: sourceCommit.slice(0, 7),
    transactions: [
      {
        transactionType: 'CREATE',
        contractName: 'MerchantRegistry',
        contractAddress: merchantRegistry,
        hash: `0x${'a'.repeat(64)}`,
        arguments: [],
      },
      {
        transactionType: 'CREATE',
        contractName: 'AdapterRegistry',
        contractAddress: adapterRegistry,
        hash: `0x${'b'.repeat(64)}`,
        arguments: [deployer, adapterManager, 'true'],
      },
      {
        transactionType: 'CREATE',
        contractName: 'PaymentRouter',
        contractAddress: paymentRouter,
        hash: `0x${'c'.repeat(64)}`,
        arguments: [deployer, merchantRegistry, adapterRegistry, feeRecipient, '50'],
      },
    ],
    receipts: [
      receipt(merchantRegistry, 'a', 100),
      receipt(adapterRegistry, 'b', 101),
      receipt(paymentRouter, 'c', 102),
    ],
    pending: [],
  };
  const broadcastText = `${JSON.stringify(broadcast, null, 2)}\n`;
  let broadcastPath = join(broadcastDirectory, 'run-latest.json');
  await writeFile(broadcastPath, broadcastText);
  const broadcastSha256 = createHash('sha256').update(broadcastText).digest('hex');
  const rpcUrl = 'http://127.0.0.1:1';
  const rpcUrlSha256 = createHash('sha256').update(rpcUrl).digest('hex');
  const recoverySidecarText = `${JSON.stringify(
    {
      transactions: broadcast.transactions.map(() => ({ rpc: rpcUrl })),
    },
    null,
    2,
  )}\n`;
  const recoverySidecarSha256 = createHash('sha256').update(recoverySidecarText).digest('hex');
  const forgeFixtureDirectory = join(root, '.forge-fixtures');
  const forgeBroadcastFixture = join(forgeFixtureDirectory, 'broadcast.json');
  const forgeCacheFixture = join(forgeFixtureDirectory, 'cache.json');
  await mkdir(forgeFixtureDirectory, { recursive: true });
  await Promise.all([
    writeFile(forgeBroadcastFixture, broadcastText, { mode: 0o600 }),
    writeFile(forgeCacheFixture, recoverySidecarText, { mode: 0o600 }),
  ]);
  let recoverySidecar;
  let resumePolicy;
  let transitionJournal;
  let resumeAuthorized = false;
  if (status === 'broadcast-partial') {
    const sharedBroadcastDirectory = join(
      root,
      '.git',
      'giwapay-deployment-evidence',
      '91342',
      'broadcast',
    );
    const sharedCacheDirectory = join(
      root,
      '.git',
      'giwapay-deployment-evidence',
      '91342',
      'cache',
    );
    await Promise.all([
      mkdir(sharedBroadcastDirectory, { recursive: true, mode: 0o700 }),
      mkdir(sharedCacheDirectory, { recursive: true, mode: 0o700 }),
    ]);
    await Promise.all([
      chmod(join(root, '.git', 'giwapay-deployment-evidence'), 0o700),
      chmod(join(root, '.git', 'giwapay-deployment-evidence', '91342'), 0o700),
      chmod(sharedBroadcastDirectory, 0o700),
      chmod(sharedCacheDirectory, 0o700),
    ]);
    broadcastPath = join(sharedBroadcastDirectory, `run-${broadcastSha256}.json`);
    const recoverySidecarPath = join(sharedCacheDirectory, `run-${recoverySidecarSha256}.json`);
    await Promise.all([
      writeFile(broadcastPath, broadcastText, { mode: 0o600 }),
      writeFile(recoverySidecarPath, recoverySidecarText, { mode: 0o600 }),
    ]);
    resumeAuthorized = true;
    recoverySidecar = {
      fileName: `run-${recoverySidecarSha256}.json`,
      sha256: recoverySidecarSha256,
      publicArtifactSha256: broadcastSha256,
      rpcUrlSha256,
      storage: 'foundry-cache-private',
    };
    resumePolicy = {
      schemaVersion: 1,
      kind: 'content-addressed-foundry-sensitive-sequence',
      forgeVersion: '1.7.1',
      forgeCommit: '4072e48705af9d93e3c0f6e29e93b5e9a40caed8',
      rpcUrlSha256,
      transactionCount: broadcast.transactions.length,
      recoverySidecarSha256,
    };
    transitionJournal = {
      fileName: `transition-${'8'.repeat(64)}.json`,
      sha256: '8'.repeat(64),
      operation: 'deploy',
      previousArtifactSha256: null,
      previousRecoverySidecarSha256: null,
      inflightGuardSha256: '9'.repeat(64),
      signingEvidenceToolingCommit: sourceCommit,
      evidenceToolingCommit: sourceCommit,
    };
  }

  const manifest = {
    schemaVersion: 2,
    project: 'GiwaPay',
    chainId: 91342,
    mode: 'giwa-sepolia',
    deploymentStatus: status,
    sourceCommit,
    evidenceToolingCommit: sourceCommit,
    deploymentScopeDirty: false,
    fullTreeDirty: false,
    broadcastArtifact: {
      fileName: status === 'broadcast-partial' ? `run-${broadcastSha256}.json` : 'run-latest.json',
      sha256: broadcastSha256,
      sourceCommit: sourceCommit.slice(0, 7),
      resumeAuthorized,
      ...(recoverySidecar ? { recoverySidecar } : {}),
      ...(resumePolicy ? { resumePolicy } : {}),
      ...(transitionJournal ? { transitionJournal } : {}),
    },
    configuration: {
      deployerAddress: deployer,
      adapterManagerAddress: adapterManager,
      platformFeeRecipient: feeRecipient,
      platformFeeBps: 50,
      productionMode: true,
      deployTestMocks: false,
    },
    configurationConflicts: [],
    deployments: [
      deployment('MerchantRegistry', merchantRegistry, 'a', 100),
      deployment('AdapterRegistry', adapterRegistry, 'b', 101),
      deployment('PaymentRouter', paymentRouter, 'c', 102),
    ],
    verification: { requested: false, status: 'not-requested', contracts: {} },
  };
  const manifestPath = join(deploymentDirectory, 'current.json');
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  const forgeLog = join(root, 'forge.log');
  const castLog = join(root, 'cast.log');
  await writeExecutable(
    join(fakeBin, 'git'),
    `#!/bin/sh
case "$*" in
  *"replace -l"*)
    if [ "\${FAKE_REPLACEMENT_REF:-false}" = "true" ]; then
      printf '%s\\n' "$FAKE_SOURCE_COMMIT"
    fi
    ;;
  *"rev-parse --git-common-dir"*) printf '%s\\n' "$FAKE_REPOSITORY_ROOT/.git" ;;
  *" init --quiet"*) ;;
  *" fetch "*) ;;
  *" update-ref "*) ;;
  *" symbolic-ref "*) ;;
  *"rev-parse --show-toplevel"*) pwd -P ;;
  *"rev-parse --git-path info/grafts"*) printf '.git/info/grafts\\n' ;;
  *"rev-parse --show-toplevel"*) printf '%s\\n' "$FAKE_REPOSITORY_ROOT" ;;
  *"rev-parse HEAD:deployments/giwa-sepolia/current.json"*)
    printf '%s\\n' "$FAKE_HEAD_MANIFEST_BLOB"
    ;;
  *"rev-parse HEAD"*)
    if [ "$1" = "-C" ] && [ "$2" = "$FAKE_REPOSITORY_ROOT" ]; then
      printf '%s\\n' "$FAKE_SOURCE_COMMIT"
    else
      printf '%s\\n' "$FAKE_BROADCAST_SOURCE_COMMIT"
    fi
    ;;
  *"ls-tree"*"scripts/assert-reviewed-worktree.mjs"*)
    printf '100644 blob %s\\tscripts/assert-reviewed-worktree.mjs\\n' "$FAKE_CHECKER_BLOB"
    ;;
  *"hash-object --no-filters"*) printf '%s\\n' "$FAKE_WORKTREE_MANIFEST_BLOB" ;;
  *"ls-files --error-unmatch"*) [ "\${FAKE_MANIFEST_TRACKED:-true}" = "true" ] ;;
  *"ls-files -v -z"*)
    if [ "\${FAKE_HIDDEN_INDEX_STATE:-false}" = "true" ]; then
      printf 'S packages/contracts/src/Hidden.sol\\0'
    fi
    ;;
  *"ls-files --others -z"*)
    if [ "\${FAKE_IGNORED_UNTRACKED:-false}" = "true" ]; then
      printf 'packages/contracts/src/Ignored.sol\\0'
    elif [ "\${FAKE_DEPLOYMENT_SCOPE_DIRTY:-false}" = "true" ]; then
      printf 'packages/contracts/src/RecoveryFixture.sol\\0'
    fi
    ;;
  *"ls-tree -r -z"*"packages/contracts"*)
    [ "\${FAKE_BROADCAST_TREE_MATCHES:-\${FAKE_SOURCE_TREE_MATCHES:-true}}" = "true" ]
    ;;
  *"ls-tree -r -z"*)
    [ "\${FAKE_TOOLING_TREE_MATCHES:-\${FAKE_SOURCE_TREE_MATCHES:-true}}" = "true" ]
    ;;
  *"ls-files -s -z"*) ;;
  *"cat-file blob "*)
    cat "$FAKE_REVIEWED_CHECKER_FIXTURE"
    ;;
  *"cat-file -e"*) [ "\${FAKE_SOURCE_COMMIT_EXISTS:-true}" = "true" ] ;;
  *"status --porcelain -- deployments/giwa-sepolia/current.json"*)
    if [ "\${FAKE_MANIFEST_DIRTY:-false}" = "true" ]; then
      printf ' M deployments/giwa-sepolia/current.json\\n'
    fi
    ;;
  *"status --porcelain"*)
    if [ "\${FAKE_DEPLOYMENT_SCOPE_DIRTY:-false}" = "true" ]; then
      printf ' M packages/contracts/src/RecoveryFixture.sol\\n'
    fi
    ;;
  *) exit 2 ;;
esac
`,
  );
  await writeExecutable(
    join(fakeBin, 'cast'),
    `#!/bin/sh
printf '%s\\n' "$*" >> "$FAKE_CAST_LOG"
case "$1" in
  chain-id) printf '91342\\n' ;;
  block) printf '0xca1b5fee64a196abfca007b3a4d4e3ec2b37be83a452d452bf4e45937004cab2\\n' ;;
  wallet) printf '%s\\n' "$FAKE_WALLET_ADDRESS" ;;
  balance) printf '1000000000000000000\\n' ;;
  call)
    case "$3" in
      "owner()(address)") printf '%s\\n' "$FAKE_WALLET_ADDRESS" ;;
      "platformFeeRecipient()(address)") printf '%s\\n' "$FAKE_FEE_RECIPIENT" ;;
      "platformFeeBps()(uint16)") printf '50\\n' ;;
      "merchantRegistry()(address)") printf '%s\\n' "$FAKE_MERCHANT_REGISTRY" ;;
      "adapterRegistry()(address)") printf '%s\\n' "$FAKE_ADAPTER_REGISTRY" ;;
      "productionMode()(bool)") printf 'true\\n' ;;
      "adapterManagers(address)(bool)") printf 'true\\n' ;;
      *) exit 3 ;;
    esac
    ;;
  *) exit 4 ;;
esac
`,
  );
  await writeExecutable(
    join(fakeBin, 'forge'),
    `#!/bin/sh
if [ "$*" = "--version" ]; then
  printf '%s\\n' 'forge Version: 1.7.1'
  printf '%s\\n' 'Commit SHA: 4072e48705af9d93e3c0f6e29e93b5e9a40caed8'
  printf '%s\\n' 'Build Timestamp: fixture'
  printf '%s\\n' 'Build Profile: fixture'
  exit 0
fi
if [ "$*" = "config --json" ]; then
  if [ "\${FAKE_FORGE_CONFIG_INVALID:-false}" = "true" ]; then
    printf '%s\\n' '{"src":"src","script":"script","out":"out","libs":["lib"],"remappings":["forge-std/=/tmp/unreviewed/"],"auto_detect_remappings":false,"libraries":[],"include_paths":[],"allow_paths":[],"skip":[],"cache_path":"cache","broadcast":"broadcast","solc":"0.8.28","evm_version":"cancun","optimizer":true,"optimizer_runs":1,"optimizer_details":null,"via_ir":true,"bytecode_hash":"none","cbor_metadata":false,"revert_strings":null,"sparse_mode":false,"ffi":false,"always_use_create_2_factory":false,"use_literal_content":false,"additional_compiler_profiles":[],"compilation_restrictions":[]}'
  else
    cat <<EOF
{"src":"src","script":"script","out":"out","libs":["lib"],"remappings":["@openzeppelin/contracts/=lib/openzeppelin-contracts/contracts/","forge-std/=lib/forge-std/src/"],"auto_detect_remappings":\${FAKE_FORGE_AUTO_DETECT_REMAPPINGS:-false},"libraries":[],"include_paths":[],"allow_paths":[],"skip":[],"cache_path":"\${FAKE_FORGE_CACHE_PATH:-cache}","broadcast":"\${FAKE_FORGE_BROADCAST_PATH:-broadcast}","build_info_path":\${FAKE_FORGE_BUILD_INFO_PATH_JSON:-null},"test_failures_file":"\${FAKE_FORGE_TEST_FAILURES_PATH:-cache/test-failures}","fuzz":{"failure_persist_dir":"\${FAKE_FORGE_FUZZ_FAILURE_PATH:-cache/fuzz}","corpus_dir":\${FAKE_FORGE_FUZZ_CORPUS_PATH_JSON:-null}},"invariant":{"failure_persist_dir":"\${FAKE_FORGE_INVARIANT_FAILURE_PATH:-cache/invariant}","corpus_dir":\${FAKE_FORGE_INVARIANT_CORPUS_PATH_JSON:-null}},"network":\${FAKE_FORGE_NETWORK_JSON:-null},"celo":\${FAKE_FORGE_CELO:-false},"hardfork":\${FAKE_FORGE_HARDFORK_JSON:-null},"fork_block_number":\${FAKE_FORGE_FORK_BLOCK_NUMBER_JSON:-null},"chain_id":\${FAKE_FORGE_CHAIN_ID_JSON:-null},"isolate":\${FAKE_FORGE_ISOLATE:-false},"script_execution_protection":\${FAKE_FORGE_SCRIPT_PROTECTION:-true},"solc":"0.8.28","evm_version":"cancun","optimizer":true,"optimizer_runs":20000,"optimizer_details":null,"via_ir":true,"bytecode_hash":"none","cbor_metadata":false,"revert_strings":null,"sparse_mode":false,"ffi":false,"always_use_create_2_factory":\${FAKE_FORGE_ALWAYS_CREATE2:-false},"use_literal_content":false,"additional_compiler_profiles":[],"compilation_restrictions":[]}
EOF
  fi
  exit 0
fi
if [ "\${FAKE_FORGE_ASSERT_STAGED_RESUME_INPUTS:-false}" = "true" ]; then
  case "$PWD" in
    */giwapay-reviewed-deploy.*/packages/contracts) ;;
    *) exit 90 ;;
  esac
  node -e '
    const fs = require("node:fs");
    const [expectedBroadcast, actualBroadcast, expectedCache, actualCache] =
      process.argv.slice(1);
    if (
      !fs.readFileSync(expectedBroadcast).equals(fs.readFileSync(actualBroadcast)) ||
      !fs.readFileSync(expectedCache).equals(fs.readFileSync(actualCache))
    ) process.exit(1);
  ' \
    "$FAKE_FORGE_EXPECTED_STAGED_BROADCAST" \
    broadcast/DeployGiwaSepolia.s.sol/91342/run-latest.json \
    "$FAKE_FORGE_EXPECTED_STAGED_CACHE" \
    cache/DeployGiwaSepolia.s.sol/91342/run-latest.json || exit 91
fi
if [ "\${FAKE_FORGE_WRITE_EVIDENCE:-false}" = "true" ]; then
  mkdir -p \
    broadcast/DeployGiwaSepolia.s.sol/91342 \
    cache/DeployGiwaSepolia.s.sol/91342
  cp "\${FAKE_FORGE_OUTPUT_BROADCAST_FIXTURE:-$FAKE_FORGE_BROADCAST_FIXTURE}" \
    broadcast/DeployGiwaSepolia.s.sol/91342/run-latest.json
  cp "\${FAKE_FORGE_OUTPUT_CACHE_FIXTURE:-$FAKE_FORGE_CACHE_FIXTURE}" \
    cache/DeployGiwaSepolia.s.sol/91342/run-latest.json
  chmod 600 \
    broadcast/DeployGiwaSepolia.s.sol/91342/run-latest.json \
    cache/DeployGiwaSepolia.s.sol/91342/run-latest.json
fi
printf '%s|%s\\n' "$ETH_RPC_URL" "$*" >> "$FAKE_FORGE_LOG"
exit "\${FAKE_FORGE_EXIT:-29}"
`,
  );

  return {
    root,
    wrapper,
    broadcast,
    broadcastDirectory,
    broadcastPath,
    manifestPath,
    forgeLog,
    castLog,
    forgeBroadcastFixture,
    forgeCacheFixture,
    rpcUrl,
    rpcUrlSha256,
    recoverySidecarSha256,
    environment: {
      ...inheritedEnvironment,
      PATH: `${fakeBin}:${nodeBinaryDirectory}:${process.env.PATH}`,
      TMPDIR: join(root, 'tmp'),
      FAKE_SOURCE_COMMIT: sourceCommit,
      FAKE_BROADCAST_SOURCE_COMMIT: sourceCommit,
      FAKE_REPOSITORY_ROOT: root,
      FAKE_HEAD_MANIFEST_BLOB: manifestBlob,
      FAKE_WORKTREE_MANIFEST_BLOB: manifestBlob,
      FAKE_CHECKER_BLOB: checkerBlob,
      FAKE_REVIEWED_CHECKER_FIXTURE: reviewedCheckerFixture,
      FAKE_WALLET_ADDRESS: deployer,
      FAKE_FEE_RECIPIENT: feeRecipient,
      FAKE_MERCHANT_REGISTRY: merchantRegistry,
      FAKE_ADAPTER_REGISTRY: adapterRegistry,
      FAKE_FORGE_LOG: forgeLog,
      FAKE_CAST_LOG: castLog,
      FAKE_FORGE_BROADCAST_FIXTURE: forgeBroadcastFixture,
      FAKE_FORGE_CACHE_FIXTURE: forgeCacheFixture,
      FAKE_FORGE_EXIT: '29',
      GIWA_RPC_URL: 'http://127.0.0.1:1',
      GIWA_EXPLORER_URL: 'https://sepolia-explorer.giwa.io',
      GIWA_EXPLORER_API_URL: 'http://127.0.0.1:1',
      DEPLOYER_ADDRESS: deployer,
      ADAPTER_MANAGER_ADDRESS: adapterManager,
      PLATFORM_FEE_RECIPIENT: feeRecipient,
      PLATFORM_FEE_BPS: '50',
      PRODUCTION_MODE: 'true',
      DEPLOY_TEST_MOCKS: 'false',
    },
  };
}

function receipt(contractAddress, hashCharacter, blockNumber) {
  return {
    contractAddress,
    transactionHash: `0x${hashCharacter.repeat(64)}`,
    blockHash: `0x${String(blockNumber).padStart(64, '0')}`,
    blockNumber: `0x${blockNumber.toString(16)}`,
    status: '0x1',
  };
}

function deployment(contractName, address, hashCharacter, blockNumber) {
  return {
    contractName,
    address,
    transactionHash: `0x${hashCharacter.repeat(64)}`,
    blockNumber: String(blockNumber),
    runtimeCodeStatus: 'confirmed',
  };
}

function notDeployedManifest(overrides = {}) {
  return {
    schemaVersion: 2,
    project: 'GiwaPay',
    chainId: 91342,
    mode: 'giwa-sepolia',
    deploymentStatus: 'not-deployed',
    sourceCommit: null,
    evidenceToolingCommit: null,
    deploymentScopeDirty: null,
    fullTreeDirty: null,
    contracts: {},
    contractEvidence: {},
    configurationConflicts: [],
    mockReadiness: {
      status: 'unknown',
      reason: 'No reviewed public deployment has established mock mode.',
    },
    verification: {
      requested: false,
      status: 'not-requested',
      contracts: {},
    },
    notes: ['No reviewed public GIWA Sepolia deployment has been recorded.'],
    ...overrides,
  };
}

async function writeExecutable(path, content) {
  await writeFile(path, content);
  await chmod(path, 0o755);
}

async function runExpectingFailure(wrapper, environment) {
  let failure;
  try {
    await execFileAsync('/bin/bash', [wrapper], {
      env: environment,
      timeout: 15_000,
      maxBuffer: 1024 * 1024,
    });
  } catch (error) {
    failure = error;
  }
  assert.ok(failure, 'expected wrapper invocation to fail');
  return failure;
}

async function readOptional(path) {
  try {
    return await readFile(path, 'utf8');
  } catch {
    return '';
  }
}

async function prepareInterruptedDeployHarness(harness, { swapWorkspaceToSymlink = false } = {}) {
  await writeFile(harness.manifestPath, `${JSON.stringify(notDeployedManifest(), null, 2)}\n`);
  await rm(harness.broadcastPath);

  const sealedWorkspaceParent = await realpath(join(harness.root, 'tmp'));
  const sealedWorkspace = join(sealedWorkspaceParent, 'giwapay-reviewed-deploy.interrupted');
  let outputWorkspace = sealedWorkspace;
  const interruptedBroadcastDirectory = join(
    outputWorkspace,
    'packages',
    'contracts',
    'broadcast',
    'DeployGiwaSepolia.s.sol',
    '91342',
  );
  const interruptedCacheDirectory = join(
    outputWorkspace,
    'packages',
    'contracts',
    'cache',
    'DeployGiwaSepolia.s.sol',
    '91342',
  );
  await mkdir(interruptedBroadcastDirectory, { recursive: true, mode: 0o700 });
  await mkdir(interruptedCacheDirectory, { recursive: true, mode: 0o700 });
  await chmod(outputWorkspace, 0o700);
  const interruptedBroadcastPath = join(interruptedBroadcastDirectory, 'run-latest.json');
  const interruptedCachePath = join(interruptedCacheDirectory, 'run-latest.json');
  await Promise.all([
    copyFile(harness.forgeBroadcastFixture, interruptedBroadcastPath),
    copyFile(harness.forgeCacheFixture, interruptedCachePath),
  ]);
  await Promise.all([chmod(interruptedBroadcastPath, 0o600), chmod(interruptedCachePath, 0o600)]);
  const sealedWorkspaceStats = await lstat(sealedWorkspace, { bigint: true });
  if (swapWorkspaceToSymlink) {
    outputWorkspace = join(harness.root, 'outside-interrupted-workspace');
    await rename(sealedWorkspace, outputWorkspace);
    await symlink(outputWorkspace, sealedWorkspace, 'dir');
  }

  const guardPath = join(harness.root, '.git', 'giwapay-deployment-91342-inflight.json');
  const guard = {
    schemaVersion: 1,
    project: 'GiwaPay',
    chainId: 91342,
    attemptToken: '11111111-1111-4111-8111-111111111111',
    operation: 'deploy',
    sourceCommit,
    signingEvidenceToolingCommit: sourceCommit,
    inputArtifactSha256: null,
    inputRecoverySidecarSha256: null,
    expectedRpcUrlSha256: harness.rpcUrlSha256,
    sealedWorkspace,
    sealedWorkspaceParent,
    sealedWorkspaceName: basename(sealedWorkspace),
    sealedWorkspaceDevice: sealedWorkspaceStats.dev.toString(),
    sealedWorkspaceInode: sealedWorkspaceStats.ino.toString(),
    fullTreeDirty: false,
    configuration: {
      deployerAddress: deployer,
      adapterManagerAddress: adapterManager,
      platformFeeRecipient: feeRecipient,
      platformFeeBps: 50,
      productionMode: true,
      deployTestMocks: false,
    },
    startedAt: '2026-07-30T00:00:00.000Z',
  };
  await writeFile(guardPath, `${JSON.stringify(guard, null, 2)}\n`, {
    mode: 0o600,
  });
  return { guardPath, outputWorkspace, sealedWorkspace };
}

for (const invalidPlaceholder of [
  {
    name: 'missing',
    prepare: (manifestPath) => rm(manifestPath),
  },
  {
    name: 'malformed',
    prepare: (manifestPath) => writeFile(manifestPath, '{malformed\n'),
  },
  {
    name: 'legacy schema',
    prepare: (manifestPath) =>
      writeFile(
        manifestPath,
        `${JSON.stringify(notDeployedManifest({ schemaVersion: 1 }), null, 2)}\n`,
      ),
  },
  {
    name: 'wrong network',
    prepare: (manifestPath) =>
      writeFile(
        manifestPath,
        `${JSON.stringify(
          notDeployedManifest({ chainId: 1, mode: 'ethereum-mainnet' }),
          null,
          2,
        )}\n`,
      ),
  },
  {
    name: 'recorded deployment evidence',
    prepare: (manifestPath) =>
      writeFile(
        manifestPath,
        `${JSON.stringify(
          notDeployedManifest({
            contracts: { paymentRouter },
          }),
          null,
          2,
        )}\n`,
      ),
  },
]) {
  test(`NEW DEPLOY rejects a ${invalidPlaceholder.name} manifest before network or Forge`, async (context) => {
    const harness = await createHarness(context);
    await invalidPlaceholder.prepare(harness.manifestPath);

    const failure = await runExpectingFailure(harness.wrapper, {
      ...harness.environment,
      CONFIRM_GIWA_SEPOLIA_DEPLOY: '91342',
      GIWAPAY_DEPLOYER_ACCOUNT: 'fixture-account',
    });

    assert.match(
      failure.stderr,
      /requires (?:the exact reviewed GIWA Sepolia not-deployed manifest placeholder|the tracked GIWA Sepolia not-deployed manifest placeholder)/,
    );
    assert.equal(await readOptional(harness.castLog), '');
    assert.equal(await readOptional(harness.forgeLog), '');
  });
}

test('NEW DEPLOY accepts only the exact reviewed not-deployed placeholder', async (context) => {
  const harness = await createHarness(context);
  await writeFile(harness.manifestPath, `${JSON.stringify(notDeployedManifest(), null, 2)}\n`);
  await rm(harness.broadcastPath);

  const failure = await runExpectingFailure(harness.wrapper, {
    ...harness.environment,
    CONFIRM_GIWA_SEPOLIA_DEPLOY: '91342',
    GIWAPAY_DEPLOYER_ACCOUNT: 'fixture-account',
  });

  assert.match(await readOptional(harness.castLog), /^chain-id$/m, failure.stderr);
  assert.match(await readOptional(harness.forgeLog), /--broadcast/);
  assert.match(await readOptional(harness.forgeLog), /--force/);
});

test('NEW DEPLOY seals a non-authorized transition and RECONCILE validates it before closing the guard', async (context) => {
  const harness = await createHarness(context, {
    useRealTransitionHelper: true,
  });
  await writeFile(harness.manifestPath, `${JSON.stringify(notDeployedManifest(), null, 2)}\n`);
  await rm(harness.broadcastPath);

  const deployFailure = await runExpectingFailure(harness.wrapper, {
    ...harness.environment,
    CONFIRM_GIWA_SEPOLIA_DEPLOY: '91342',
    GIWAPAY_DEPLOYER_ACCOUNT: 'fixture-account',
    FAKE_FORGE_WRITE_EVIDENCE: 'true',
  });
  assert.match(deployFailure.stderr, /sealed without authorizing another signature/i);

  const transition = JSON.parse(await readFile(harness.manifestPath, 'utf8'));
  assert.equal(transition.deploymentStatus, 'broadcast-transition');
  assert.equal(transition.broadcastArtifact.resumeAuthorized, false);
  assert.match(transition.broadcastArtifact.fileName, /^run-[0-9a-f]{64}\.json$/);
  assert.match(transition.broadcastArtifact.recoverySidecar.fileName, /^run-[0-9a-f]{64}\.json$/);
  assert.match(
    transition.broadcastArtifact.transitionJournal.fileName,
    /^transition-[0-9a-f]{64}\.json$/,
  );

  const guardPath = join(harness.root, '.git', 'giwapay-deployment-91342-inflight.json');
  const guard = JSON.parse(await readFile(guardPath, 'utf8'));
  assert.equal((await stat(guard.sealedWorkspace)).isDirectory(), true);

  await execFileAsync('/bin/bash', [harness.wrapper], {
    env: {
      ...harness.environment,
      RECONCILE_GIWA_SEPOLIA_DEPLOY: '91342',
      RECONCILE_VERIFICATION_REQUESTED: 'false',
    },
    timeout: 20_000,
    maxBuffer: 1024 * 1024,
  });

  const reconciled = JSON.parse(await readFile(harness.manifestPath, 'utf8'));
  assert.equal(reconciled.deploymentStatus, 'broadcast-complete');
  assert.equal(reconciled.broadcastArtifact.resumeAuthorized, false);
  assert.ok(reconciled.broadcastArtifact.recoverySidecar);
  assert.ok(reconciled.broadcastArtifact.transitionJournal);
  await assert.rejects(stat(guardPath), { code: 'ENOENT' });
  await assert.rejects(stat(guard.sealedWorkspace), { code: 'ENOENT' });
});

test('RECONCILE can close an exact committed guard after its disposable workspace is already absent', async (context) => {
  const harness = await createHarness(context, {
    useRealTransitionHelper: true,
  });
  await writeFile(harness.manifestPath, `${JSON.stringify(notDeployedManifest(), null, 2)}\n`);
  await rm(harness.broadcastPath);

  const deployFailure = await runExpectingFailure(harness.wrapper, {
    ...harness.environment,
    CONFIRM_GIWA_SEPOLIA_DEPLOY: '91342',
    GIWAPAY_DEPLOYER_ACCOUNT: 'fixture-account',
    FAKE_FORGE_WRITE_EVIDENCE: 'true',
  });
  assert.match(deployFailure.stderr, /sealed without authorizing another signature/i);

  const guardPath = join(harness.root, '.git', 'giwapay-deployment-91342-inflight.json');
  const guard = JSON.parse(await readFile(guardPath, 'utf8'));
  await rm(guard.sealedWorkspace, { recursive: true });

  await execFileAsync('/bin/bash', [harness.wrapper], {
    env: {
      ...harness.environment,
      RECONCILE_GIWA_SEPOLIA_DEPLOY: '91342',
      RECONCILE_VERIFICATION_REQUESTED: 'false',
    },
    timeout: 20_000,
    maxBuffer: 1024 * 1024,
  });

  const reconciled = JSON.parse(await readFile(harness.manifestPath, 'utf8'));
  assert.equal(reconciled.deploymentStatus, 'broadcast-complete');
  assert.equal(reconciled.broadcastArtifact.resumeAuthorized, false);
  await assert.rejects(stat(guardPath), { code: 'ENOENT' });
});

test('RECONCILE recovers interrupted sealed Forge output before a second review-only close', async (context) => {
  const harness = await createHarness(context, {
    useRealTransitionHelper: true,
  });
  const { guardPath, sealedWorkspace } = await prepareInterruptedDeployHarness(harness);

  const forgeLogBeforeRecovery = await readOptional(harness.forgeLog);
  const firstRecovery = await execFileAsync('/bin/bash', [harness.wrapper], {
    env: {
      ...harness.environment,
      RECONCILE_GIWA_SEPOLIA_DEPLOY: '91342',
      RECONCILE_VERIFICATION_REQUESTED: 'false',
      DEPLOYMENT_SOURCE_COMMIT_OVERRIDE: sourceCommit,
    },
    timeout: 20_000,
    maxBuffer: 1024 * 1024,
  });

  assert.match(firstRecovery.stdout, /Recovered the interrupted Forge output without signing/);
  const recoveredTransition = JSON.parse(await readFile(harness.manifestPath, 'utf8'));
  assert.equal(recoveredTransition.deploymentStatus, 'broadcast-transition');
  assert.equal(recoveredTransition.broadcastArtifact.resumeAuthorized, false);
  assert.equal(recoveredTransition.broadcastArtifact.transitionJournal.operation, 'deploy');
  assert.equal(
    recoveredTransition.broadcastArtifact.transitionJournal.signingEvidenceToolingCommit,
    sourceCommit,
  );
  assert.equal((await stat(guardPath)).isFile(), true);
  assert.equal((await stat(sealedWorkspace)).isDirectory(), true);
  assert.equal(await readOptional(harness.forgeLog), forgeLogBeforeRecovery);

  await execFileAsync('/bin/bash', [harness.wrapper], {
    env: {
      ...harness.environment,
      RECONCILE_GIWA_SEPOLIA_DEPLOY: '91342',
      RECONCILE_VERIFICATION_REQUESTED: 'false',
    },
    timeout: 20_000,
    maxBuffer: 1024 * 1024,
  });

  const reconciled = JSON.parse(await readFile(harness.manifestPath, 'utf8'));
  assert.equal(reconciled.deploymentStatus, 'broadcast-complete');
  assert.equal(reconciled.broadcastArtifact.resumeAuthorized, false);
  assert.equal(await readOptional(harness.forgeLog), forgeLogBeforeRecovery);
  await assert.rejects(stat(guardPath), { code: 'ENOENT' });
  await assert.rejects(stat(sealedWorkspace), { code: 'ENOENT' });
});

test('RECONCILE rejects an interrupted workspace symlink swap before staging evidence', async (context) => {
  const harness = await createHarness(context, {
    useRealTransitionHelper: true,
  });
  const { guardPath, outputWorkspace, sealedWorkspace } = await prepareInterruptedDeployHarness(
    harness,
    {
      swapWorkspaceToSymlink: true,
    },
  );
  const manifestBefore = await readFile(harness.manifestPath);

  const failure = await runExpectingFailure(harness.wrapper, {
    ...harness.environment,
    RECONCILE_GIWA_SEPOLIA_DEPLOY: '91342',
    RECONCILE_VERIFICATION_REQUESTED: 'false',
    DEPLOYMENT_SOURCE_COMMIT_OVERRIDE: sourceCommit,
  });

  assert.match(failure.stderr, /original private recovery boundary/i);
  assert.deepEqual(await readFile(harness.manifestPath), manifestBefore);
  assert.equal((await stat(guardPath)).isFile(), true);
  assert.equal((await lstat(sealedWorkspace)).isSymbolicLink(), true);
  assert.equal((await stat(outputWorkspace)).isDirectory(), true);
  await assert.rejects(stat(join(outputWorkspace, '.giwapay-evidence')), { code: 'ENOENT' });
  assert.equal(await readOptional(harness.forgeLog), '');
});

test('RESUME stages both sealed inputs, records a non-authorized monotonic transition, and RECONCILE closes its guard', async (context) => {
  const harness = await createHarness(context, {
    useRealTransitionHelper: true,
  });
  const partialBroadcast = JSON.parse(JSON.stringify(harness.broadcast));
  partialBroadcast.receipts = partialBroadcast.receipts.slice(0, 2);
  partialBroadcast.pending = [
    {
      transactionHash: partialBroadcast.transactions[2].hash,
      nonce: '0x2',
    },
  ];
  const partialBroadcastText = `${JSON.stringify(partialBroadcast, null, 2)}\n`;
  await writeFile(harness.forgeBroadcastFixture, partialBroadcastText, { mode: 0o600 });
  await writeFile(harness.manifestPath, `${JSON.stringify(notDeployedManifest(), null, 2)}\n`);
  await rm(harness.broadcastPath);

  const deployFailure = await runExpectingFailure(harness.wrapper, {
    ...harness.environment,
    CONFIRM_GIWA_SEPOLIA_DEPLOY: '91342',
    GIWAPAY_DEPLOYER_ACCOUNT: 'fixture-account',
    FAKE_FORGE_WRITE_EVIDENCE: 'true',
  });
  assert.match(deployFailure.stderr, /sealed without authorizing another signature/i);

  await execFileAsync('/bin/bash', [harness.wrapper], {
    env: {
      ...harness.environment,
      RECONCILE_GIWA_SEPOLIA_DEPLOY: '91342',
      RECONCILE_VERIFICATION_REQUESTED: 'false',
    },
    timeout: 20_000,
    maxBuffer: 1024 * 1024,
  });

  const authorized = JSON.parse(await readFile(harness.manifestPath, 'utf8'));
  assert.equal(authorized.deploymentStatus, 'broadcast-partial');
  assert.equal(authorized.broadcastArtifact.resumeAuthorized, true);
  const previousArtifactSha256 = authorized.broadcastArtifact.sha256;
  const previousRecoverySidecarSha256 = authorized.broadcastArtifact.recoverySidecar.sha256;
  const sharedEvidenceRoot = join(harness.root, '.git', 'giwapay-deployment-evidence', '91342');
  const previousArtifactPath = join(
    sharedEvidenceRoot,
    'broadcast',
    authorized.broadcastArtifact.fileName,
  );
  const previousRecoverySidecarPath = join(
    sharedEvidenceRoot,
    'cache',
    authorized.broadcastArtifact.recoverySidecar.fileName,
  );

  const nextBroadcast = JSON.parse(JSON.stringify(harness.broadcast));
  nextBroadcast.pending = [];
  const nextBroadcastPath = join(harness.root, '.forge-fixtures', 'resume-next.json');
  await writeFile(nextBroadcastPath, `${JSON.stringify(nextBroadcast, null, 2)}\n`, {
    mode: 0o600,
  });

  const resumeFailure = await runExpectingFailure(harness.wrapper, {
    ...harness.environment,
    RESUME_GIWA_SEPOLIA_DEPLOY: '91342',
    GIWAPAY_DEPLOYER_ACCOUNT: 'fixture-account',
    FAKE_FORGE_ASSERT_STAGED_RESUME_INPUTS: 'true',
    FAKE_FORGE_EXPECTED_STAGED_BROADCAST: previousArtifactPath,
    FAKE_FORGE_EXPECTED_STAGED_CACHE: previousRecoverySidecarPath,
    FAKE_FORGE_OUTPUT_BROADCAST_FIXTURE: nextBroadcastPath,
    FAKE_FORGE_WRITE_EVIDENCE: 'true',
  });
  assert.match(resumeFailure.stderr, /sealed without authorizing another signature/i);

  const transition = JSON.parse(await readFile(harness.manifestPath, 'utf8'));
  assert.equal(transition.deploymentStatus, 'broadcast-transition');
  assert.equal(transition.broadcastArtifact.resumeAuthorized, false);
  assert.equal(transition.broadcastArtifact.transitionJournal.operation, 'resume');
  assert.equal(
    transition.broadcastArtifact.transitionJournal.previousArtifactSha256,
    previousArtifactSha256,
  );
  assert.equal(
    transition.broadcastArtifact.transitionJournal.previousRecoverySidecarSha256,
    previousRecoverySidecarSha256,
  );

  const transitionJournalPath = join(
    sharedEvidenceRoot,
    'broadcast',
    transition.broadcastArtifact.transitionJournal.fileName,
  );
  const transitionJournal = JSON.parse(await readFile(transitionJournalPath, 'utf8'));
  assert.equal(transitionJournal.previousArtifactSha256, previousArtifactSha256);
  assert.equal(transitionJournal.previousRecoverySidecarSha256, previousRecoverySidecarSha256);

  const guardPath = join(harness.root, '.git', 'giwapay-deployment-91342-inflight.json');
  const guard = JSON.parse(await readFile(guardPath, 'utf8'));
  assert.equal(guard.operation, 'resume');
  assert.equal(guard.inputArtifactSha256, previousArtifactSha256);
  assert.equal(guard.inputRecoverySidecarSha256, previousRecoverySidecarSha256);
  assert.equal((await stat(guard.sealedWorkspace)).isDirectory(), true);
  const forgeLogBeforeReconcile = await readFile(harness.forgeLog, 'utf8');

  await execFileAsync('/bin/bash', [harness.wrapper], {
    env: {
      ...harness.environment,
      RECONCILE_GIWA_SEPOLIA_DEPLOY: '91342',
      RECONCILE_VERIFICATION_REQUESTED: 'false',
    },
    timeout: 20_000,
    maxBuffer: 1024 * 1024,
  });

  const reconciled = JSON.parse(await readFile(harness.manifestPath, 'utf8'));
  assert.equal(reconciled.deploymentStatus, 'broadcast-complete');
  assert.equal(reconciled.broadcastArtifact.resumeAuthorized, false);
  assert.equal(await readFile(harness.forgeLog, 'utf8'), forgeLogBeforeReconcile);
  await assert.rejects(stat(guardPath), { code: 'ENOENT' });
  await assert.rejects(stat(guard.sealedWorkspace), { code: 'ENOENT' });
});

test('NEW DEPLOY rejects inherited Foundry configuration overrides before network or Forge', async (context) => {
  const harness = await createHarness(context);
  await writeFile(harness.manifestPath, `${JSON.stringify(notDeployedManifest(), null, 2)}\n`);
  await rm(harness.broadcastPath);

  const failure = await runExpectingFailure(harness.wrapper, {
    ...harness.environment,
    CONFIRM_GIWA_SEPOLIA_DEPLOY: '91342',
    GIWAPAY_DEPLOYER_ACCOUNT: 'fixture-account',
    FOUNDRY_OPTIMIZER_RUNS: '1',
  });

  assert.match(failure.stderr, /Unset inherited Foundry\/Dapp configuration overrides/);
  assert.equal(await readOptional(harness.castLog), '');
  assert.equal(await readOptional(harness.forgeLog), '');
});

for (const gasPriceEnvironmentName of ['ETH_GAS_PRICE', 'ETH_PRIORITY_GAS_PRICE']) {
  test(`NEW DEPLOY rejects inherited ${gasPriceEnvironmentName} before network or Forge`, async (context) => {
    const harness = await createHarness(context);
    await writeFile(harness.manifestPath, `${JSON.stringify(notDeployedManifest(), null, 2)}\n`);
    await rm(harness.broadcastPath);

    const failure = await runExpectingFailure(harness.wrapper, {
      ...harness.environment,
      CONFIRM_GIWA_SEPOLIA_DEPLOY: '91342',
      GIWAPAY_DEPLOYER_ACCOUNT: 'fixture-account',
      [gasPriceEnvironmentName]: '999999999999',
    });

    assert.match(failure.stderr, /Unset inherited Foundry\/Dapp configuration overrides/);
    assert.equal(await readOptional(harness.castLog), '');
    assert.equal(await readOptional(harness.forgeLog), '');
  });
}

test('NEW DEPLOY rejects Git replacement refs before network or Forge', async (context) => {
  const harness = await createHarness(context);
  await writeFile(harness.manifestPath, `${JSON.stringify(notDeployedManifest(), null, 2)}\n`);
  await rm(harness.broadcastPath);

  const failure = await runExpectingFailure(harness.wrapper, {
    ...harness.environment,
    CONFIRM_GIWA_SEPOLIA_DEPLOY: '91342',
    GIWAPAY_DEPLOYER_ACCOUNT: 'fixture-account',
    FAKE_REPLACEMENT_REF: 'true',
  });

  assert.match(failure.stderr, /Git replacement refs are not allowed/);
  assert.equal(await readOptional(harness.castLog), '');
  assert.equal(await readOptional(harness.forgeLog), '');
});

test('NEW DEPLOY rejects inherited Git repository redirects before network or Forge', async (context) => {
  const harness = await createHarness(context);

  const failure = await runExpectingFailure(harness.wrapper, {
    ...harness.environment,
    CONFIRM_GIWA_SEPOLIA_DEPLOY: '91342',
    GIWAPAY_DEPLOYER_ACCOUNT: 'fixture-account',
    GIT_DIR: '/tmp/unreviewed-giwapay.git',
    GIT_WORK_TREE: harness.root,
  });

  assert.match(failure.stderr, /Unset inherited Git repository\/configuration redirects/);
  assert.equal(await readOptional(harness.castLog), '');
  assert.equal(await readOptional(harness.forgeLog), '');
});

test('RECONCILE rejects an effective compiler or import configuration mismatch before network', async (context) => {
  const harness = await createHarness(context);
  const manifestText = `${JSON.stringify(notDeployedManifest(), null, 2)}\n`;
  await writeFile(harness.manifestPath, manifestText);

  const failure = await runExpectingFailure(harness.wrapper, {
    ...harness.environment,
    RECONCILE_GIWA_SEPOLIA_DEPLOY: '91342',
    RECONCILE_VERIFICATION_REQUESTED: 'false',
    DEPLOYMENT_SOURCE_COMMIT_OVERRIDE: sourceCommit,
    FAKE_FORGE_CONFIG_INVALID: 'true',
  });

  assert.match(failure.stderr, /Effective Foundry deployment configuration differs/);
  assert.equal(await readFile(harness.manifestPath, 'utf8'), manifestText);
  assert.equal(await readOptional(harness.castLog), '');
  assert.equal(await readOptional(harness.forgeLog), '');
});

for (const unsafeFoundryPath of [
  {
    name: 'cache path',
    environment: { FAKE_FORGE_CACHE_PATH: '/tmp/unreviewed-cache' },
  },
  {
    name: 'broadcast path',
    environment: { FAKE_FORGE_BROADCAST_PATH: '/tmp/unreviewed-broadcast' },
  },
  {
    name: 'CREATE2 factory mode',
    environment: { FAKE_FORGE_ALWAYS_CREATE2: 'true' },
  },
  {
    name: 'build-info cleanup path',
    environment: { FAKE_FORGE_BUILD_INFO_PATH_JSON: '"/tmp/unreviewed-build-info"' },
  },
  {
    name: 'test-failure cleanup path',
    environment: { FAKE_FORGE_TEST_FAILURES_PATH: '/tmp/unreviewed-test-failures' },
  },
  {
    name: 'fuzz failure cleanup path',
    environment: { FAKE_FORGE_FUZZ_FAILURE_PATH: '/tmp/unreviewed-fuzz-failures' },
  },
  {
    name: 'fuzz corpus cleanup path',
    environment: { FAKE_FORGE_FUZZ_CORPUS_PATH_JSON: '"/tmp/unreviewed-fuzz-corpus"' },
  },
  {
    name: 'invariant failure cleanup path',
    environment: { FAKE_FORGE_INVARIANT_FAILURE_PATH: '/tmp/unreviewed-invariant-failures' },
  },
  {
    name: 'invariant corpus cleanup path',
    environment: {
      FAKE_FORGE_INVARIANT_CORPUS_PATH_JSON: '"/tmp/unreviewed-invariant-corpus"',
    },
  },
  {
    name: 'network mode',
    environment: { FAKE_FORGE_NETWORK_JSON: '"tempo"' },
  },
  {
    name: 'Celo transaction mode',
    environment: { FAKE_FORGE_CELO: 'true' },
  },
  {
    name: 'hardfork mode',
    environment: { FAKE_FORGE_HARDFORK_JSON: '"shanghai"' },
  },
  {
    name: 'fork block',
    environment: { FAKE_FORGE_FORK_BLOCK_NUMBER_JSON: '123' },
  },
  {
    name: 'configured chain ID',
    environment: { FAKE_FORGE_CHAIN_ID_JSON: '1' },
  },
  {
    name: 'isolated execution mode',
    environment: { FAKE_FORGE_ISOLATE: 'true' },
  },
  {
    name: 'disabled script execution protection',
    environment: { FAKE_FORGE_SCRIPT_PROTECTION: 'false' },
  },
]) {
  test(`RECONCILE rejects an effective ${unsafeFoundryPath.name} override before network`, async (context) => {
    const harness = await createHarness(context);
    const manifestText = `${JSON.stringify(notDeployedManifest(), null, 2)}\n`;
    await writeFile(harness.manifestPath, manifestText);

    const failure = await runExpectingFailure(harness.wrapper, {
      ...harness.environment,
      RECONCILE_GIWA_SEPOLIA_DEPLOY: '91342',
      RECONCILE_VERIFICATION_REQUESTED: 'false',
      DEPLOYMENT_SOURCE_COMMIT_OVERRIDE: sourceCommit,
      ...unsafeFoundryPath.environment,
    });

    assert.match(failure.stderr, /Effective Foundry deployment configuration differs/);
    assert.equal(await readFile(harness.manifestPath, 'utf8'), manifestText);
    assert.equal(await readOptional(harness.castLog), '');
    assert.equal(await readOptional(harness.forgeLog), '');
  });
}

test('RECONCILE accepts legacy auto-detected remappings when their resolved list is reviewed', async (context) => {
  const harness = await createHarness(context);
  await writeFile(harness.manifestPath, `${JSON.stringify(notDeployedManifest(), null, 2)}\n`);

  await execFileAsync('/bin/bash', [harness.wrapper], {
    env: {
      ...harness.environment,
      RECONCILE_GIWA_SEPOLIA_DEPLOY: '91342',
      RECONCILE_VERIFICATION_REQUESTED: 'false',
      DEPLOYMENT_SOURCE_COMMIT_OVERRIDE: sourceCommit,
      FAKE_FORGE_AUTO_DETECT_REMAPPINGS: 'true',
    },
    timeout: 15_000,
    maxBuffer: 1024 * 1024,
  });

  const manifest = JSON.parse(await readFile(harness.manifestPath, 'utf8'));
  assert.equal(manifest.sourceCommit, sourceCommit);
  assert.equal(manifest.deploymentScopeDirty, false);
  assert.match(await readOptional(harness.castLog), /^chain-id$/m);
});

test('RECONCILE establishes a clean deployment scope from a clean recovered checkout', async (context) => {
  const harness = await createHarness(context);
  await writeFile(harness.manifestPath, `${JSON.stringify(notDeployedManifest(), null, 2)}\n`);

  await execFileAsync('/bin/bash', [harness.wrapper], {
    env: {
      ...harness.environment,
      RECONCILE_GIWA_SEPOLIA_DEPLOY: '91342',
      RECONCILE_VERIFICATION_REQUESTED: 'false',
      DEPLOYMENT_SOURCE_COMMIT_OVERRIDE: sourceCommit,
    },
    timeout: 15_000,
    maxBuffer: 1024 * 1024,
  });

  const manifest = JSON.parse(await readFile(harness.manifestPath, 'utf8'));
  assert.equal(manifest.deploymentScopeDirty, false);
  assert.equal(manifest.fullTreeDirty, null);
  assert.equal(await readOptional(harness.forgeLog), '');

  await runExpectingFailure(harness.wrapper, {
    ...harness.environment,
    VERIFY_GIWA_SEPOLIA_DEPLOY: '91342',
  });
  assert.match(await readOptional(harness.forgeLog), /verify-contract/);
});

test('RECONCILE can adopt fixed evidence tooling without changing the broadcast source commit', async (context) => {
  const harness = await createHarness(context);
  await writeFile(harness.manifestPath, `${JSON.stringify(notDeployedManifest(), null, 2)}\n`);
  const repairedEnvironment = {
    ...harness.environment,
    FAKE_SOURCE_COMMIT: toolingCommit,
  };

  await execFileAsync('/bin/bash', [harness.wrapper], {
    env: {
      ...repairedEnvironment,
      RECONCILE_GIWA_SEPOLIA_DEPLOY: '91342',
      RECONCILE_VERIFICATION_REQUESTED: 'false',
      DEPLOYMENT_SOURCE_COMMIT_OVERRIDE: sourceCommit,
    },
    timeout: 15_000,
    maxBuffer: 1024 * 1024,
  });

  const manifest = JSON.parse(await readFile(harness.manifestPath, 'utf8'));
  assert.equal(manifest.sourceCommit, sourceCommit);
  assert.equal(manifest.evidenceToolingCommit, toolingCommit);
  assert.equal(manifest.deploymentScopeDirty, false);
  assert.equal(await readOptional(harness.forgeLog), '');

  await runExpectingFailure(harness.wrapper, {
    ...repairedEnvironment,
    VERIFY_GIWA_SEPOLIA_DEPLOY: '91342',
  });
  assert.match(await readOptional(harness.forgeLog), /verify-contract/);
});

test('RECONCILE refuses to replace a committed broadcast artifact digest', async (context) => {
  const harness = await createHarness(context);
  const manifestText = await readFile(harness.manifestPath, 'utf8');
  await writeFile(harness.broadcastPath, '\n', { flag: 'a' });

  const failure = await runExpectingFailure(harness.wrapper, {
    ...harness.environment,
    RECONCILE_GIWA_SEPOLIA_DEPLOY: '91342',
    RECONCILE_VERIFICATION_REQUESTED: 'false',
  });

  assert.match(failure.stderr, /refuses to replace the committed broadcast artifact SHA-256/);
  assert.equal(await readFile(harness.manifestPath, 'utf8'), manifestText);
  assert.equal(await readOptional(harness.castLog), '');
  assert.equal(await readOptional(harness.forgeLog), '');
});

test('RECONCILE rejects hidden Git index state before network or extraction', async (context) => {
  const harness = await createHarness(context);
  const manifestText = `${JSON.stringify(notDeployedManifest(), null, 2)}\n`;
  await writeFile(harness.manifestPath, manifestText);

  const failure = await runExpectingFailure(harness.wrapper, {
    ...harness.environment,
    RECONCILE_GIWA_SEPOLIA_DEPLOY: '91342',
    RECONCILE_VERIFICATION_REQUESTED: 'false',
    DEPLOYMENT_SOURCE_COMMIT_OVERRIDE: sourceCommit,
    FAKE_HIDDEN_INDEX_STATE: 'true',
  });

  assert.match(failure.stderr, /special Git index state is not allowed/);
  assert.equal(await readFile(harness.manifestPath, 'utf8'), manifestText);
  assert.equal(await readOptional(harness.castLog), '');
  assert.equal(await readOptional(harness.forgeLog), '');
});

test('RECONCILE bootstraps the checker from the reviewed Git blob, not mutable worktree bytes', async (context) => {
  const harness = await createHarness(context);
  const manifestText = `${JSON.stringify(notDeployedManifest(), null, 2)}\n`;
  await writeFile(harness.manifestPath, manifestText);
  await writeFile(
    join(harness.root, 'scripts', 'assert-reviewed-worktree.mjs'),
    `import fs from 'node:fs';
import path from 'node:path';
const [root, , , destination, ...reviewedPaths] = process.argv.slice(2);
for (const reviewedPath of reviewedPaths) {
  const source = path.join(root, reviewedPath);
  if (!fs.existsSync(source)) continue;
  const target = path.join(destination, reviewedPath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.cpSync(source, target, { recursive: true, errorOnExist: true, force: false });
}
`,
  );

  const failure = await runExpectingFailure(harness.wrapper, {
    ...harness.environment,
    RECONCILE_GIWA_SEPOLIA_DEPLOY: '91342',
    RECONCILE_VERIFICATION_REQUESTED: 'false',
    DEPLOYMENT_SOURCE_COMMIT_OVERRIDE: sourceCommit,
    FAKE_TOOLING_TREE_MATCHES: 'false',
  });

  assert.match(failure.stderr, /Deployment and evidence tooling must exactly match/);
  assert.equal(await readFile(harness.manifestPath, 'utf8'), manifestText);
  assert.equal(await readOptional(harness.castLog), '');
  assert.equal(await readOptional(harness.forgeLog), '');
});

test('RECONCILE rejects an ignored untracked source before network or extraction', async (context) => {
  const harness = await createHarness(context);
  const manifestText = `${JSON.stringify(notDeployedManifest(), null, 2)}\n`;
  await writeFile(harness.manifestPath, manifestText);

  const failure = await runExpectingFailure(harness.wrapper, {
    ...harness.environment,
    RECONCILE_GIWA_SEPOLIA_DEPLOY: '91342',
    RECONCILE_VERIFICATION_REQUESTED: 'false',
    DEPLOYMENT_SOURCE_COMMIT_OVERRIDE: sourceCommit,
    FAKE_IGNORED_UNTRACKED: 'true',
  });

  assert.match(failure.stderr, /including an ignored file/);
  assert.equal(await readFile(harness.manifestPath, 'utf8'), manifestText);
  assert.equal(await readOptional(harness.castLog), '');
  assert.equal(await readOptional(harness.forgeLog), '');
});

test('RECONCILE rejects a dirty recovered source scope before network or extraction', async (context) => {
  const harness = await createHarness(context);
  const manifestText = `${JSON.stringify(notDeployedManifest(), null, 2)}\n`;
  await writeFile(harness.manifestPath, manifestText);

  const failure = await runExpectingFailure(harness.wrapper, {
    ...harness.environment,
    RECONCILE_GIWA_SEPOLIA_DEPLOY: '91342',
    RECONCILE_VERIFICATION_REQUESTED: 'false',
    DEPLOYMENT_SOURCE_COMMIT_OVERRIDE: sourceCommit,
    FAKE_DEPLOYMENT_SCOPE_DIRTY: 'true',
  });

  assert.match(failure.stderr, /Broadcast-critical source must exactly match/);
  assert.equal(await readFile(harness.manifestPath, 'utf8'), manifestText);
  assert.equal(await readOptional(harness.castLog), '');
  assert.equal(await readOptional(harness.forgeLog), '');
});

for (const invalidSourceEvidence of [
  {
    name: 'source differs from the recorded commit',
    environment: { FAKE_SOURCE_TREE_MATCHES: 'false' },
  },
  {
    name: 'recorded source commit is unavailable',
    environment: { FAKE_SOURCE_COMMIT_EXISTS: 'false' },
  },
]) {
  test(`RECONCILE rejects recovery when ${invalidSourceEvidence.name}`, async (context) => {
    const harness = await createHarness(context);
    const manifestText = `${JSON.stringify(notDeployedManifest(), null, 2)}\n`;
    await writeFile(harness.manifestPath, manifestText);

    const failure = await runExpectingFailure(harness.wrapper, {
      ...harness.environment,
      RECONCILE_GIWA_SEPOLIA_DEPLOY: '91342',
      RECONCILE_VERIFICATION_REQUESTED: 'false',
      DEPLOYMENT_SOURCE_COMMIT_OVERRIDE: sourceCommit,
      ...invalidSourceEvidence.environment,
    });

    assert.match(failure.stderr, /Broadcast-critical source must exactly match/);
    assert.equal(await readFile(harness.manifestPath, 'utf8'), manifestText);
    assert.equal(await readOptional(harness.castLog), '');
    assert.equal(await readOptional(harness.forgeLog), '');
  });
}

test('RECONCILE rejects an untracked manifest before network or Forge', async (context) => {
  const harness = await createHarness(context);
  await writeFile(harness.manifestPath, `${JSON.stringify(notDeployedManifest(), null, 2)}\n`);

  const failure = await runExpectingFailure(harness.wrapper, {
    ...harness.environment,
    RECONCILE_GIWA_SEPOLIA_DEPLOY: '91342',
    RECONCILE_VERIFICATION_REQUESTED: 'false',
    DEPLOYMENT_SOURCE_COMMIT_OVERRIDE: sourceCommit,
    FAKE_MANIFEST_TRACKED: 'false',
  });

  assert.match(failure.stderr, /manifest must be tracked/);
  assert.equal(await readOptional(harness.castLog), '');
  assert.equal(await readOptional(harness.forgeLog), '');
});

for (const committedScopeDirty of [null, true]) {
  test(`RECONCILE rejects a dirty working-copy false before it can replace committed ${committedScopeDirty} scope evidence`, async (context) => {
    const harness = await createHarness(context);
    const workingManifest = JSON.parse(await readFile(harness.manifestPath, 'utf8'));
    workingManifest.deploymentScopeDirty = false;
    const workingManifestText = `${JSON.stringify(workingManifest, null, 2)}\n`;
    await writeFile(harness.manifestPath, workingManifestText);

    const failure = await runExpectingFailure(harness.wrapper, {
      ...harness.environment,
      RECONCILE_GIWA_SEPOLIA_DEPLOY: '91342',
      RECONCILE_VERIFICATION_REQUESTED: 'false',
      FAKE_MANIFEST_DIRTY: 'true',
    });

    assert.match(failure.stderr, /manifest must be clean/);
    assert.equal(await readOptional(harness.castLog), '');
    assert.equal(await readOptional(harness.forgeLog), '');
    assert.equal(await readFile(harness.manifestPath, 'utf8'), workingManifestText);
  });
}

for (const committedScopeDirty of [null, true]) {
  test(`RECONCILE rejects an ignored manifest blob mismatch before it can replace committed ${committedScopeDirty} scope evidence`, async (context) => {
    const harness = await createHarness(context);
    const workingManifest = JSON.parse(await readFile(harness.manifestPath, 'utf8'));
    workingManifest.deploymentScopeDirty = false;
    const workingManifestText = `${JSON.stringify(workingManifest, null, 2)}\n`;
    await writeFile(harness.manifestPath, workingManifestText);

    const failure = await runExpectingFailure(harness.wrapper, {
      ...harness.environment,
      RECONCILE_GIWA_SEPOLIA_DEPLOY: '91342',
      RECONCILE_VERIFICATION_REQUESTED: 'false',
      FAKE_WORKTREE_MANIFEST_BLOB: '8888888888888888888888888888888888888888',
    });

    assert.match(failure.stderr, /manifest must exactly match the reviewed HEAD blob/);
    assert.equal(await readOptional(harness.castLog), '');
    assert.equal(await readOptional(harness.forgeLog), '');
    assert.equal(await readFile(harness.manifestPath, 'utf8'), workingManifestText);
  });
}

test('NEW DEPLOY rejects an ignored manifest blob mismatch before network or Forge', async (context) => {
  const harness = await createHarness(context);
  await writeFile(harness.manifestPath, `${JSON.stringify(notDeployedManifest(), null, 2)}\n`);
  await rm(harness.broadcastPath);

  const failure = await runExpectingFailure(harness.wrapper, {
    ...harness.environment,
    CONFIRM_GIWA_SEPOLIA_DEPLOY: '91342',
    GIWAPAY_DEPLOYER_ACCOUNT: 'fixture-account',
    FAKE_WORKTREE_MANIFEST_BLOB: '8888888888888888888888888888888888888888',
  });

  assert.match(failure.stderr, /manifest must exactly match the reviewed HEAD blob/);
  assert.equal(await readOptional(harness.castLog), '');
  assert.equal(await readOptional(harness.forgeLog), '');
});

for (const recoveryOperation of [
  {
    name: 'RESUME',
    status: 'broadcast-partial',
    environment: {
      RESUME_GIWA_SEPOLIA_DEPLOY: '91342',
      GIWAPAY_DEPLOYER_ACCOUNT: 'fixture-account',
    },
  },
  {
    name: 'VERIFY',
    status: 'broadcast-complete',
    environment: { VERIFY_GIWA_SEPOLIA_DEPLOY: '91342' },
  },
]) {
  test(`${recoveryOperation.name} rejects an ignored manifest blob mismatch before network or Forge`, async (context) => {
    const harness = await createHarness(context, { status: recoveryOperation.status });

    const failure = await runExpectingFailure(harness.wrapper, {
      ...harness.environment,
      ...recoveryOperation.environment,
      FAKE_WORKTREE_MANIFEST_BLOB: '8888888888888888888888888888888888888888',
    });

    assert.match(failure.stderr, /manifest must exactly match the reviewed HEAD blob/);
    assert.equal(await readOptional(harness.castLog), '');
    assert.equal(await readOptional(harness.forgeLog), '');
  });
}

for (const establishedScopeDirty of [false, true]) {
  test(`RECONCILE preserves committed ${establishedScopeDirty} scope evidence from a clean checkout`, async (context) => {
    const harness = await createHarness(context);
    const existingManifest = JSON.parse(await readFile(harness.manifestPath, 'utf8'));
    existingManifest.deploymentScopeDirty = establishedScopeDirty;
    await writeFile(harness.manifestPath, `${JSON.stringify(existingManifest, null, 2)}\n`);

    await execFileAsync('/bin/bash', [harness.wrapper], {
      env: {
        ...harness.environment,
        RECONCILE_GIWA_SEPOLIA_DEPLOY: '91342',
        RECONCILE_VERIFICATION_REQUESTED: 'false',
      },
      timeout: 15_000,
      maxBuffer: 1024 * 1024,
    });

    const manifest = JSON.parse(await readFile(harness.manifestPath, 'utf8'));
    assert.equal(manifest.deploymentScopeDirty, establishedScopeDirty);
    assert.equal(manifest.fullTreeDirty, false);
    assert.equal(await readOptional(harness.forgeLog), '');
  });
}

test('VERIFY invokes only non-signing forge verify-contract commands', async (context) => {
  const harness = await createHarness(context);
  const environment = {
    ...harness.environment,
    VERIFY_GIWA_SEPOLIA_DEPLOY: '91342',
    GIWAPAY_DEPLOYER_ACCOUNT: 'must-not-be-opened',
    FAKE_FORGE_EXIT: '0',
  };

  await runExpectingFailure(harness.wrapper, environment);

  const forgeLog = await readOptional(harness.forgeLog);
  const castLog = await readOptional(harness.castLog);
  assert.match(forgeLog, /verify-contract/);
  assert.doesNotMatch(forgeLog, /--broadcast|--resume|--account|forge script/);
  assert.doesNotMatch(castLog, /^wallet\b/m);
  assert.match(forgeLog, /--rpc-url http:\/\/127\.0\.0\.1:1/);
  assert.match(forgeLog, /--verifier-url http:\/\/127\.0\.0\.1:1/);
  const verificationCommands = forgeLog.trim().split('\n');
  assert.equal(verificationCommands.length, 3);
  assert.ok(
    verificationCommands.every((command) =>
      command.startsWith('http://127.0.0.1:1|verify-contract '),
    ),
  );
  assert.match(forgeLog, /MerchantRegistry\.sol:MerchantRegistry/);
  assert.match(forgeLog, /AdapterRegistry\.sol:AdapterRegistry/);
  assert.match(forgeLog, /PaymentRouter\.sol:PaymentRouter/);
});

test('VERIFY rejects a tampered broadcast artifact before Forge', async (context) => {
  const harness = await createHarness(context);
  await writeFile(harness.broadcastPath, '\n', { flag: 'a' });

  await runExpectingFailure(harness.wrapper, {
    ...harness.environment,
    VERIFY_GIWA_SEPOLIA_DEPLOY: '91342',
  });
  assert.equal(await readOptional(harness.forgeLog), '');
});

for (const status of ['broadcast-complete', 'evidence-conflict']) {
  test(`RESUME rejects ${status} state before Forge`, async (context) => {
    const harness = await createHarness(context, { status });
    await runExpectingFailure(harness.wrapper, {
      ...harness.environment,
      RESUME_GIWA_SEPOLIA_DEPLOY: '91342',
      GIWAPAY_DEPLOYER_ACCOUNT: 'fixture-account',
    });
    assert.equal(await readOptional(harness.forgeLog), '');
  });
}

test('RESUME reaches Forge only for matching broadcast-partial evidence', async (context) => {
  const harness = await createHarness(context, { status: 'broadcast-partial' });
  await runExpectingFailure(harness.wrapper, {
    ...harness.environment,
    RESUME_GIWA_SEPOLIA_DEPLOY: '91342',
    GIWAPAY_DEPLOYER_ACCOUNT: 'fixture-account',
  });

  const forgeLog = await readOptional(harness.forgeLog);
  assert.match(forgeLog, /\|script script\/DeployGiwaSepolia\.s\.sol:DeployGiwaSepolia /);
  assert.match(forgeLog, /--account fixture-account/);
  assert.match(forgeLog, /--broadcast/);
  assert.match(forgeLog, /--resume/);
  assert.match(forgeLog, /--force/);
  assert.match(forgeLog, /--rpc-url http:\/\/127\.0\.0\.1:1/);
});

test('RESUME rejects recorded configuration mismatch before Forge', async (context) => {
  const harness = await createHarness(context, { status: 'broadcast-partial' });
  await runExpectingFailure(harness.wrapper, {
    ...harness.environment,
    RESUME_GIWA_SEPOLIA_DEPLOY: '91342',
    GIWAPAY_DEPLOYER_ACCOUNT: 'fixture-account',
    PLATFORM_FEE_BPS: '75',
  });
  assert.equal(await readOptional(harness.forgeLog), '');
});

test('VERIFY rejects a source checkout mismatch before network or Forge', async (context) => {
  const harness = await createHarness(context);

  const failure = await runExpectingFailure(harness.wrapper, {
    ...harness.environment,
    VERIFY_GIWA_SEPOLIA_DEPLOY: '91342',
    FAKE_BROADCAST_TREE_MATCHES: 'false',
  });
  assert.match(failure.stderr, /Broadcast-critical source must exactly match/);
  assert.equal(await readOptional(harness.castLog), '');
  assert.equal(await readOptional(harness.forgeLog), '');
});

test('VERIFY rejects a missing evidence tooling commit before network or Forge', async (context) => {
  const harness = await createHarness(context);
  const manifest = JSON.parse(await readFile(harness.manifestPath, 'utf8'));
  delete manifest.evidenceToolingCommit;
  await writeFile(harness.manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  const failure = await runExpectingFailure(harness.wrapper, {
    ...harness.environment,
    VERIFY_GIWA_SEPOLIA_DEPLOY: '91342',
  });
  assert.match(failure.stderr, /reviewed evidence tooling SHA/);
  assert.equal(await readOptional(harness.castLog), '');
  assert.equal(await readOptional(harness.forgeLog), '');
});

test('VERIFY rejects an evidence tooling checkout mismatch before network or Forge', async (context) => {
  const harness = await createHarness(context);

  const failure = await runExpectingFailure(harness.wrapper, {
    ...harness.environment,
    VERIFY_GIWA_SEPOLIA_DEPLOY: '91342',
    FAKE_TOOLING_TREE_MATCHES: 'false',
  });
  assert.match(failure.stderr, /Deployment and evidence tooling must exactly match/);
  assert.equal(await readOptional(harness.castLog), '');
  assert.equal(await readOptional(harness.forgeLog), '');
});

test('RESUME rejects account-derived deployer mismatch before Forge', async (context) => {
  const harness = await createHarness(context, { status: 'broadcast-partial' });
  await runExpectingFailure(harness.wrapper, {
    ...harness.environment,
    RESUME_GIWA_SEPOLIA_DEPLOY: '91342',
    GIWAPAY_DEPLOYER_ACCOUNT: 'fixture-account',
    FAKE_WALLET_ADDRESS: '0x9999999999999999999999999999999999999999',
  });
  assert.equal(await readOptional(harness.forgeLog), '');
});

test('VERIFY rejects an untracked recovery manifest before Forge', async (context) => {
  const harness = await createHarness(context);
  const failure = await runExpectingFailure(harness.wrapper, {
    ...harness.environment,
    VERIFY_GIWA_SEPOLIA_DEPLOY: '91342',
    FAKE_MANIFEST_TRACKED: 'false',
  });
  assert.match(failure.stderr, /manifest must be tracked/);
  assert.equal(await readOptional(harness.castLog), '');
  assert.equal(await readOptional(harness.forgeLog), '');
});

test('RESUME rejects a modified recovery manifest before Forge', async (context) => {
  const harness = await createHarness(context, { status: 'broadcast-partial' });
  const failure = await runExpectingFailure(harness.wrapper, {
    ...harness.environment,
    RESUME_GIWA_SEPOLIA_DEPLOY: '91342',
    GIWAPAY_DEPLOYER_ACCOUNT: 'fixture-account',
    FAKE_MANIFEST_DIRTY: 'true',
  });
  assert.match(failure.stderr, /manifest must be clean/);
  assert.equal(await readOptional(harness.castLog), '');
  assert.equal(await readOptional(harness.forgeLog), '');
});
