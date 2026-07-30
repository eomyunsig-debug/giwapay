import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmod, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import test from 'node:test';

const execFileAsync = promisify(execFile);
const scriptsDirectory = dirname(fileURLToPath(import.meta.url));
const sourceCommit = '1234567890abcdef1234567890abcdef12345678';
const deployer = '0x4444444444444444444444444444444444444444';
const adapterManager = '0x5555555555555555555555555555555555555555';
const feeRecipient = '0x6666666666666666666666666666666666666666';
const merchantRegistry = '0x1111111111111111111111111111111111111111';
const adapterRegistry = '0x2222222222222222222222222222222222222222';
const paymentRouter = '0x3333333333333333333333333333333333333333';

async function createHarness(context, { status = 'broadcast-complete' } = {}) {
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
  ]);

  const wrapper = join(scriptDirectory, 'deploy-giwa-sepolia.sh');
  await copyFile(join(scriptsDirectory, 'deploy-giwa-sepolia.sh'), wrapper);
  await copyFile(
    join(scriptsDirectory, 'extract-deployment.mjs'),
    join(scriptDirectory, 'extract-deployment.mjs'),
  );
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
  const broadcastPath = join(broadcastDirectory, 'run-latest.json');
  await writeFile(broadcastPath, broadcastText);

  const manifest = {
    schemaVersion: 2,
    project: 'GiwaPay',
    chainId: 91342,
    mode: 'giwa-sepolia',
    deploymentStatus: status,
    sourceCommit,
    deploymentScopeDirty: false,
    fullTreeDirty: false,
    broadcastArtifact: {
      fileName: 'run-latest.json',
      sha256: createHash('sha256').update(broadcastText).digest('hex'),
      sourceCommit: sourceCommit.slice(0, 7),
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
  *"rev-parse HEAD"*) printf '%s\\n' "$FAKE_SOURCE_COMMIT" ;;
  *"ls-files --error-unmatch"*) [ "\${FAKE_MANIFEST_TRACKED:-true}" = "true" ] ;;
  *"diff --quiet"*) [ "\${FAKE_SOURCE_TREE_MATCHES:-true}" = "true" ] ;;
  *"status --porcelain"*)
    if [ "\${FAKE_DEPLOYMENT_SCOPE_DIRTY:-false}" = "true" ]; then
      printf ' M deployments/giwa-sepolia/current.json\\n'
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
printf '%s|%s\\n' "$ETH_RPC_URL" "$*" >> "$FAKE_FORGE_LOG"
exit "\${FAKE_FORGE_EXIT:-29}"
`,
  );

  return {
    root,
    wrapper,
    broadcastPath,
    manifestPath,
    forgeLog,
    castLog,
    environment: {
      ...process.env,
      PATH: `${fakeBin}:${process.env.PATH}`,
      FAKE_SOURCE_COMMIT: sourceCommit,
      FAKE_WALLET_ADDRESS: deployer,
      FAKE_FEE_RECIPIENT: feeRecipient,
      FAKE_MERCHANT_REGISTRY: merchantRegistry,
      FAKE_ADAPTER_REGISTRY: adapterRegistry,
      FAKE_FORGE_LOG: forgeLog,
      FAKE_CAST_LOG: castLog,
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

  await runExpectingFailure(harness.wrapper, {
    ...harness.environment,
    CONFIRM_GIWA_SEPOLIA_DEPLOY: '91342',
    GIWAPAY_DEPLOYER_ACCOUNT: 'fixture-account',
  });

  assert.match(await readOptional(harness.castLog), /^chain-id$/m);
  assert.match(await readOptional(harness.forgeLog), /--broadcast/);
});

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

test('VERIFY rejects a source checkout mismatch before Forge', async (context) => {
  const harness = await createHarness(context);
  const manifest = JSON.parse(await readFile(harness.manifestPath, 'utf8'));
  manifest.sourceCommit = 'ffffffffffffffffffffffffffffffffffffffff';
  await writeFile(harness.manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  await runExpectingFailure(harness.wrapper, {
    ...harness.environment,
    VERIFY_GIWA_SEPOLIA_DEPLOY: '91342',
  });
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
  await runExpectingFailure(harness.wrapper, {
    ...harness.environment,
    VERIFY_GIWA_SEPOLIA_DEPLOY: '91342',
    FAKE_MANIFEST_TRACKED: 'false',
  });
  assert.equal(await readOptional(harness.forgeLog), '');
});

test('RESUME rejects a modified recovery manifest before Forge', async (context) => {
  const harness = await createHarness(context, { status: 'broadcast-partial' });
  await runExpectingFailure(harness.wrapper, {
    ...harness.environment,
    RESUME_GIWA_SEPOLIA_DEPLOY: '91342',
    GIWAPAY_DEPLOYER_ACCOUNT: 'fixture-account',
    FAKE_DEPLOYMENT_SCOPE_DIRTY: 'true',
  });
  assert.equal(await readOptional(harness.forgeLog), '');
});
