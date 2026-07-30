import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import test from 'node:test';

const execFileAsync = promisify(execFile);
const scriptsDirectory = dirname(fileURLToPath(import.meta.url));
const helperPath = join(scriptsDirectory, 'capture-deployment-transition.mjs');

const sourceCommit = '1234567890abcdef1234567890abcdef12345678';
const toolingCommit = 'abcdef1234567890abcdef1234567890abcdef12';
const reconciledToolingCommit = 'fedcba0987654321fedcba0987654321fedcba09';
const rpcUrl = 'https://rpc.test.invalid/giwa-sepolia';
const rpcUrlSha256 = sha256(Buffer.from(rpcUrl));
const deployToken = '11111111-1111-4111-8111-111111111111';
const resumeToken = '22222222-2222-4222-8222-222222222222';
const wrongToken = '33333333-3333-4333-8333-333333333333';

const helperEnvironment = {
  ...process.env,
  GIWAPAY_WRAPPER_PID: String(process.pid),
  DEPLOYER_ADDRESS: '0x1111111111111111111111111111111111111111',
  ADAPTER_MANAGER_ADDRESS: '0x2222222222222222222222222222222222222222',
  PLATFORM_FEE_RECIPIENT: '0x3333333333333333333333333333333333333333',
  PLATFORM_FEE_BPS: '50',
  PRODUCTION_MODE: 'true',
  DEPLOY_TEST_MOCKS: 'false',
};

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function jsonBytes(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
}

async function makePrivateDirectory(path) {
  await mkdir(path, { recursive: true, mode: 0o700 });
  await chmod(path, 0o700);
}

async function writePrivate(path, bytes) {
  await writeFile(path, bytes, { mode: 0o600 });
  await chmod(path, 0o600);
}

async function writePrivateJson(path, value) {
  await writePrivate(path, jsonBytes(value));
}

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

async function runHelper(command, argumentsList, environment = {}) {
  return execFileAsync(process.execPath, [helperPath, command, ...argumentsList], {
    env: { ...helperEnvironment, ...environment },
  });
}

function forgeCache(transactionCount = 2) {
  return {
    transactions: Array.from({ length: transactionCount }, () => ({
      rpc: rpcUrl,
    })),
  };
}

const transactions = [
  {
    hash: `0x${'a'.repeat(64)}`,
    transactionType: 'CREATE',
    transaction: {
      from: '0x1111111111111111111111111111111111111111',
      nonce: '0x0',
      data: '0x6001',
    },
  },
  {
    hash: `0x${'b'.repeat(64)}`,
    transactionType: 'CALL',
    transaction: {
      from: '0x1111111111111111111111111111111111111111',
      to: '0x4444444444444444444444444444444444444444',
      nonce: '0x1',
      data: '0x1234',
    },
  },
];

const firstReceipt = {
  transactionHash: transactions[0].hash,
  status: '0x1',
  blockNumber: '0x64',
};

const secondReceipt = {
  transactionHash: transactions[1].hash,
  status: '0x1',
  blockNumber: '0x65',
};

const firstPending = {
  transactionHash: transactions[0].hash,
  nonce: '0x0',
};

const secondPending = {
  transactionHash: transactions[1].hash,
  nonce: '0x1',
};

function broadcast({
  transactionList = transactions,
  receipts = [firstReceipt],
  pending = [firstPending, secondPending],
} = {}) {
  return {
    transactions: transactionList,
    receipts,
    pending,
    chain: 91342,
    commit: sourceCommit.slice(0, 7),
  };
}

async function createFixture(context, label) {
  const temporaryRoot = await mkdtemp(
    join(await realpath(tmpdir()), `giwapay-transition-${label}-`),
  );
  const root = await realpath(temporaryRoot);
  context.after(() => rm(root, { recursive: true, force: true }));

  const broadcastDirectory = join(root, 'evidence', 'broadcast');
  const cacheDirectory = join(root, 'evidence', 'cache');
  const sealedWorkspace = join(root, 'giwapay-reviewed-deploy.fixture');
  const sealedEvidenceDirectory = join(sealedWorkspace, '.giwapay-evidence');
  const manifestPath = join(sealedWorkspace, 'current.json');
  const forgeOutputPath = join(sealedWorkspace, 'run-latest.json');
  const forgeCachePath = join(sealedWorkspace, 'cache-latest.json');
  const guardPath = join(root, 'giwapay-deployment-91342-inflight.json');
  const lockPath = join(root, 'giwapay-deployment.lock');

  await makePrivateDirectory(join(root, 'evidence'));
  await makePrivateDirectory(broadcastDirectory);
  await makePrivateDirectory(cacheDirectory);
  await makePrivateDirectory(sealedWorkspace);
  await makePrivateDirectory(sealedEvidenceDirectory);
  await writePrivateJson(manifestPath, {
    schemaVersion: 2,
    project: 'GiwaPay',
    chainId: 91342,
    mode: 'giwa-sepolia',
    deploymentStatus: 'not-deployed',
    notes: ['test fixture'],
  });

  return {
    root,
    broadcastDirectory,
    cacheDirectory,
    sealedWorkspace,
    sealedEvidenceDirectory,
    manifestPath,
    forgeOutputPath,
    forgeCachePath,
    guardPath,
    lockPath,
  };
}

async function begin({
  fixture,
  token,
  operation,
  inputArtifactSha256 = 'none',
  inputSidecarSha256 = 'none',
  sealedWorkspace = fixture.sealedWorkspace,
  fullTreeDirty = 'false',
  writeOwner = true,
}) {
  if (writeOwner) {
    await writePrivateJson(fixture.lockPath, {
      schemaVersion: 1,
      token,
      pid: process.pid,
      operation,
      startedAt: new Date().toISOString(),
    });
  }
  return runHelper('begin', [
    fixture.root,
    fixture.broadcastDirectory,
    fixture.cacheDirectory,
    fixture.guardPath,
    token,
    operation,
    sourceCommit,
    toolingCommit,
    inputArtifactSha256,
    inputSidecarSha256,
    sealedWorkspace,
    fullTreeDirty,
    rpcUrlSha256,
  ]);
}

async function capture({
  fixture,
  operation,
  previousArtifactPath = '-',
  previousSidecarPath = '-',
  forgeExitCode = '1',
}) {
  return runHelper('capture', [
    fixture.manifestPath,
    fixture.forgeOutputPath,
    fixture.forgeCachePath,
    previousArtifactPath,
    previousSidecarPath,
    fixture.root,
    fixture.broadcastDirectory,
    fixture.cacheDirectory,
    fixture.sealedEvidenceDirectory,
    fixture.guardPath,
    operation,
    forgeExitCode,
    sourceCommit,
    toolingCommit,
    'false',
  ]);
}

async function validate({
  fixture,
  manifestPath = fixture.manifestPath,
  artifactPath,
  sidecarPath,
}) {
  return runHelper('validate', [
    manifestPath,
    artifactPath,
    sidecarPath,
    fixture.root,
    fixture.broadcastDirectory,
    fixture.cacheDirectory,
    rpcUrlSha256,
  ]);
}

async function captureInitialDeploy(context, label) {
  const fixture = await createFixture(context, label);
  const outputBytes = jsonBytes(broadcast());
  const cacheBytes = jsonBytes(forgeCache());
  await writePrivate(fixture.forgeOutputPath, outputBytes);
  await writePrivate(fixture.forgeCachePath, cacheBytes);
  await begin({
    fixture,
    token: deployToken,
    operation: 'deploy',
  });
  const capturedOutput = await capture({ fixture, operation: 'deploy' });
  const result = JSON.parse(capturedOutput.stdout);
  const manifest = await readJson(fixture.manifestPath);

  return {
    fixture,
    result,
    helperStdout: capturedOutput.stdout,
    manifest,
    outputBytes,
    cacheBytes,
    artifactPath: result.sealedArtifactPath,
    sidecarPath: result.sealedRecoverySidecarPath,
    canonicalArtifactPath: join(fixture.broadcastDirectory, manifest.broadcastArtifact.fileName),
    canonicalSidecarPath: join(
      fixture.cacheDirectory,
      manifest.broadcastArtifact.recoverySidecar.fileName,
    ),
    canonicalJournalPath: join(
      fixture.broadcastDirectory,
      manifest.broadcastArtifact.transitionJournal.fileName,
    ),
  };
}

async function authorizePartialManifest(path) {
  const manifest = await readJson(path);
  manifest.deploymentStatus = 'broadcast-partial';
  manifest.broadcastArtifact.resumeAuthorized = true;
  await writePrivateJson(path, manifest);
  return manifest;
}

test('begin rejects direct helper use without the active wrapper lock', async (context) => {
  const fixture = await createFixture(context, 'missing-wrapper-lock');
  await assert.rejects(
    begin({
      fixture,
      token: deployToken,
      operation: 'deploy',
      writeOwner: false,
    }),
    /active (?:deployment )?wrapper (?:lock|process)/i,
  );
  await assert.rejects(stat(fixture.guardPath), { code: 'ENOENT' });
});

test('begin records an immutable private guard and complete is token-bound', async (context) => {
  const fixture = await createFixture(context, 'guard');

  const started = await begin({
    fixture,
    token: deployToken,
    operation: 'deploy',
    fullTreeDirty: 'true',
  });
  assert.equal(started.stdout, fixture.guardPath);

  const guard = await readJson(fixture.guardPath);
  assert.equal(guard.attemptToken, deployToken);
  assert.equal(guard.operation, 'deploy');
  assert.equal(guard.sourceCommit, sourceCommit);
  assert.equal(guard.signingEvidenceToolingCommit, toolingCommit);
  assert.equal(guard.inputArtifactSha256, null);
  assert.equal(guard.inputRecoverySidecarSha256, null);
  assert.equal(guard.expectedRpcUrlSha256, rpcUrlSha256);
  assert.equal(guard.sealedWorkspace, fixture.sealedWorkspace);
  assert.match(guard.sealedWorkspaceDevice, /^\d+$/);
  assert.match(guard.sealedWorkspaceInode, /^\d+$/);
  assert.equal(guard.fullTreeDirty, true);
  assert.equal((await stat(fixture.guardPath)).mode & 0o777, 0o600);

  await assert.rejects(
    runHelper('complete', [fixture.guardPath, wrongToken]),
    /ownership token differs/i,
  );
  assert.equal((await stat(fixture.guardPath)).isFile(), true);

  await runHelper('complete', [fixture.guardPath, deployToken]);
  await assert.rejects(stat(fixture.guardPath), { code: 'ENOENT' });
  await assert.rejects(stat(fixture.sealedWorkspace), { code: 'ENOENT' });
});

test('complete rejects tampered workspace metadata without removing the guard or target', async (context) => {
  const fixture = await createFixture(context, 'cleanup-metadata');
  await begin({
    fixture,
    token: deployToken,
    operation: 'deploy',
  });

  const guard = await readJson(fixture.guardPath);
  guard.sealedWorkspaceName = 'giwapay-reviewed-deploy.changed';
  await writePrivateJson(fixture.guardPath, guard);

  await assert.rejects(
    runHelper('complete', [fixture.guardPath, deployToken]),
    /malformed|safe cleanup boundary/i,
  );
  assert.equal((await stat(fixture.guardPath)).isFile(), true);
  assert.equal((await stat(fixture.sealedWorkspace)).isDirectory(), true);
});

test('complete rejects a workspace swapped to an outside symlink without removing either target', async (context) => {
  const fixture = await createFixture(context, 'cleanup-symlink');
  const outsideTarget = join(fixture.root, 'outside-target');
  const outsideSentinel = join(outsideTarget, 'keep.txt');
  await makePrivateDirectory(outsideTarget);
  await writePrivate(outsideSentinel, Buffer.from('keep'));
  await begin({
    fixture,
    token: deployToken,
    operation: 'deploy',
  });

  await rm(fixture.sealedWorkspace, { recursive: true });
  await symlink(outsideTarget, fixture.sealedWorkspace, 'dir');

  await assert.rejects(
    runHelper('complete', [fixture.guardPath, deployToken]),
    /safe cleanup boundary/i,
  );
  assert.equal((await stat(fixture.guardPath)).isFile(), true);
  assert.equal((await stat(outsideTarget)).isDirectory(), true);
  assert.equal(await readFile(outsideSentinel, 'utf8'), 'keep');
});

test('capture rejects a workspace swapped to an outside symlink before publishing evidence', async (context) => {
  const fixture = await createFixture(context, 'capture-symlink');
  const manifestBytes = await readFile(fixture.manifestPath);
  const outputBytes = jsonBytes(broadcast());
  const cacheBytes = jsonBytes(forgeCache());
  await begin({
    fixture,
    token: deployToken,
    operation: 'deploy',
  });

  await rm(fixture.sealedWorkspace, { recursive: true });
  const outsideTarget = join(fixture.root, 'outside-capture-target');
  await makePrivateDirectory(outsideTarget);
  await makePrivateDirectory(join(outsideTarget, '.giwapay-evidence'));
  await writePrivate(join(outsideTarget, 'current.json'), manifestBytes);
  await writePrivate(join(outsideTarget, 'run-latest.json'), outputBytes);
  await writePrivate(join(outsideTarget, 'cache-latest.json'), cacheBytes);
  await symlink(outsideTarget, fixture.sealedWorkspace, 'dir');

  await assert.rejects(
    capture({ fixture, operation: 'deploy' }),
    /sealed boundary|safe cleanup boundary/i,
  );
  assert.equal((await stat(fixture.guardPath)).isFile(), true);
  await assert.rejects(stat(join(fixture.broadcastDirectory, `run-${sha256(outputBytes)}.json`)), {
    code: 'ENOENT',
  });
});

for (const invalidCache of [
  {
    name: 'an RPC URL outside the guard digest',
    label: 'wrong-rpc',
    value() {
      const value = forgeCache();
      value.transactions[0].rpc = 'https://other-rpc.test.invalid/giwa-sepolia';
      return value;
    },
  },
  {
    name: 'an unexpected transaction cache key',
    label: 'extra-key',
    value() {
      const value = forgeCache();
      value.transactions[0].unexpected = true;
      return value;
    },
  },
  {
    name: 'a transaction-count mismatch',
    label: 'count-mismatch',
    value() {
      return forgeCache(1);
    },
  },
]) {
  test(`capture rejects ${invalidCache.name} without publishing or clearing the guard`, async (context) => {
    const fixture = await createFixture(context, `cache-${invalidCache.label}`);
    await writePrivateJson(fixture.forgeOutputPath, broadcast());
    await writePrivateJson(fixture.forgeCachePath, invalidCache.value());
    const manifestBefore = await readFile(fixture.manifestPath);
    await begin({
      fixture,
      token: deployToken,
      operation: 'deploy',
    });

    await assert.rejects(
      capture({ fixture, operation: 'deploy' }),
      /sensitive recovery cache differs from the reviewed RPC sequence/i,
    );
    assert.deepEqual(await readFile(fixture.manifestPath), manifestBefore);
    assert.equal((await stat(fixture.guardPath)).isFile(), true);
  });
}

test('capture stores immutable broadcast, private cache, and journal evidence before authorizing resume', async (context) => {
  const captured = await captureInitialDeploy(context, 'deploy');
  const {
    fixture,
    result,
    helperStdout,
    manifest,
    outputBytes,
    cacheBytes,
    artifactPath,
    sidecarPath,
    canonicalArtifactPath,
    canonicalSidecarPath,
    canonicalJournalPath,
  } = captured;

  const artifactSha256 = sha256(outputBytes);
  const sidecarSha256 = sha256(cacheBytes);
  assert.equal(result.changed, true);
  assert.equal(result.sha256, artifactSha256);
  assert.equal(result.artifactFileName, `run-${artifactSha256}.json`);
  assert.equal(manifest.broadcastArtifact.fileName, `run-${artifactSha256}.json`);
  assert.equal(manifest.broadcastArtifact.sha256, artifactSha256);
  assert.equal(manifest.deploymentStatus, 'broadcast-transition');
  assert.equal(manifest.broadcastArtifact.resumeAuthorized, false);
  assert.equal(manifest.broadcastArtifact.recoverySidecar.fileName, `run-${sidecarSha256}.json`);
  assert.equal(manifest.broadcastArtifact.recoverySidecar.sha256, sidecarSha256);
  assert.equal(manifest.broadcastArtifact.recoverySidecar.publicArtifactSha256, artifactSha256);
  assert.equal(manifest.broadcastArtifact.recoverySidecar.storage, 'foundry-cache-private');

  const publicManifestText = await readFile(fixture.manifestPath, 'utf8');
  for (const publicOutput of [publicManifestText, helperStdout]) {
    assert.equal(publicOutput.includes(rpcUrl), false);
    assert.equal(publicOutput.includes('"transactions"'), false);
  }

  assert.deepEqual(await readFile(canonicalArtifactPath), outputBytes);
  assert.deepEqual(await readFile(canonicalSidecarPath), cacheBytes);
  assert.deepEqual(await readFile(artifactPath), outputBytes);
  assert.deepEqual(await readFile(sidecarPath), cacheBytes);
  for (const path of [
    canonicalArtifactPath,
    canonicalSidecarPath,
    canonicalJournalPath,
    artifactPath,
    sidecarPath,
  ]) {
    assert.equal((await stat(path)).mode & 0o777, 0o600);
  }

  const journalBytes = await readFile(canonicalJournalPath);
  const journal = JSON.parse(journalBytes);
  assert.equal(manifest.broadcastArtifact.transitionJournal.sha256, sha256(journalBytes));
  assert.equal(journal.operation, 'deploy');
  assert.equal(journal.previousArtifactSha256, null);
  assert.equal(journal.previousRecoverySidecarSha256, null);
  assert.equal(journal.nextArtifact.sha256, artifactSha256);
  assert.equal(journal.privateCacheEvidence.sha256, sidecarSha256);
  assert.equal(journal.privateCacheEvidence.persisted, true);
  assert.equal(journal.inflightGuard.record.attemptToken, deployToken);

  assert.equal(
    (
      await validate({
        fixture,
        artifactPath,
        sidecarPath,
      })
    ).stdout,
    'true',
  );

  await authorizePartialManifest(fixture.manifestPath);
  assert.equal(
    (
      await validate({
        fixture,
        artifactPath,
        sidecarPath,
      })
    ).stdout,
    'true',
  );

  const reconciledManifest = await readJson(fixture.manifestPath);
  reconciledManifest.evidenceToolingCommit = reconciledToolingCommit;
  await writePrivateJson(fixture.manifestPath, reconciledManifest);
  assert.equal(
    (
      await validate({
        fixture,
        artifactPath,
        sidecarPath,
      })
    ).stdout,
    'true',
  );
  assert.equal(
    reconciledManifest.broadcastArtifact.transitionJournal.evidenceToolingCommit,
    toolingCommit,
  );
});

test('validate rejects manifest provenance, private sidecar, and journal tampering', async (context) => {
  const captured = await captureInitialDeploy(context, 'tamper');
  const {
    fixture,
    artifactPath,
    sidecarPath,
    canonicalSidecarPath,
    canonicalJournalPath,
    cacheBytes,
  } = captured;
  const authorized = await authorizePartialManifest(fixture.manifestPath);

  const provenanceTampered = JSON.parse(JSON.stringify(authorized));
  provenanceTampered.broadcastArtifact.transitionJournal.evidenceToolingCommit =
    '9999999999999999999999999999999999999999';
  await writePrivateJson(fixture.manifestPath, provenanceTampered);
  await assert.rejects(
    validate({ fixture, artifactPath, sidecarPath }),
    /journal|provenance|manifest/i,
  );
  await writePrivateJson(fixture.manifestPath, authorized);

  const configurationTampered = JSON.parse(JSON.stringify(authorized));
  configurationTampered.configuration.platformFeeBps = 75;
  await writePrivateJson(fixture.manifestPath, configurationTampered);
  await assert.rejects(
    validate({ fixture, artifactPath, sidecarPath }),
    /journal|configuration|manifest/i,
  );
  await writePrivateJson(fixture.manifestPath, authorized);

  const dirtyStateTampered = JSON.parse(JSON.stringify(authorized));
  dirtyStateTampered.fullTreeDirty = true;
  await writePrivateJson(fixture.manifestPath, dirtyStateTampered);
  await assert.rejects(validate({ fixture, artifactPath, sidecarPath }), /journal|manifest/i);
  await writePrivateJson(fixture.manifestPath, authorized);

  await writePrivate(canonicalSidecarPath, Buffer.from('{"transactions":[]}\n'));
  await assert.rejects(
    validate({ fixture, artifactPath, sidecarPath }),
    /sidecar|cache|sha-256|canonical/i,
  );
  await writePrivate(canonicalSidecarPath, cacheBytes);

  const journalBytes = await readFile(canonicalJournalPath);
  const journal = JSON.parse(journalBytes);
  journal.nextArtifact.transactionCount += 1;
  await writePrivateJson(canonicalJournalPath, journal);
  await assert.rejects(validate({ fixture, artifactPath, sidecarPath }), /journal|sha-256/i);
});

test('resume requires the exact prior artifact and sidecar and preserves monotonic Forge state', async (context) => {
  const initial = await captureInitialDeploy(context, 'resume-base');
  const {
    fixture: initialFixture,
    manifest: initialManifest,
    canonicalArtifactPath,
    canonicalSidecarPath,
    outputBytes,
    cacheBytes,
  } = initial;
  await authorizePartialManifest(initialFixture.manifestPath);
  const initialManifestBytes = await readFile(initialFixture.manifestPath);
  await runHelper('complete', [initialFixture.guardPath, deployToken]);

  const resumeWorkspace = join(initialFixture.root, 'giwapay-reviewed-deploy.resume');
  const resumeEvidence = join(resumeWorkspace, '.giwapay-evidence');
  await makePrivateDirectory(resumeWorkspace);
  await makePrivateDirectory(resumeEvidence);
  const fixture = {
    ...initialFixture,
    sealedWorkspace: resumeWorkspace,
    sealedEvidenceDirectory: resumeEvidence,
    manifestPath: join(resumeWorkspace, 'current.json'),
    forgeOutputPath: join(resumeWorkspace, 'run-latest.json'),
    forgeCachePath: join(resumeWorkspace, 'cache-latest.json'),
  };
  await writePrivate(fixture.manifestPath, initialManifestBytes);
  await writePrivate(fixture.forgeCachePath, cacheBytes);

  const artifactSha256 = sha256(outputBytes);
  const sidecarSha256 = sha256(cacheBytes);
  assert.equal(initialManifest.broadcastArtifact.sha256, artifactSha256);
  assert.equal(initialManifest.broadcastArtifact.recoverySidecar.sha256, sidecarSha256);

  await begin({
    fixture,
    token: resumeToken,
    operation: 'resume',
    inputArtifactSha256: artifactSha256,
    inputSidecarSha256: sidecarSha256,
    sealedWorkspace: resumeWorkspace,
  });

  await writePrivate(fixture.forgeOutputPath, outputBytes);
  await writePrivate(fixture.forgeCachePath, Buffer.from(`${JSON.stringify(forgeCache())}\n`));
  const cacheOnlyRewrite = JSON.parse(
    (
      await capture({
        fixture,
        operation: 'resume',
        previousArtifactPath: canonicalArtifactPath,
        previousSidecarPath: canonicalSidecarPath,
      })
    ).stdout,
  );
  assert.equal(cacheOnlyRewrite.changed, false);

  await writePrivateJson(
    fixture.forgeOutputPath,
    broadcast({
      transactionList: [
        {
          ...transactions[0],
          transaction: {
            ...transactions[0].transaction,
            data: '0x9999',
          },
        },
        transactions[1],
      ],
    }),
  );
  await assert.rejects(
    capture({
      fixture,
      operation: 'resume',
      previousArtifactPath: canonicalArtifactPath,
      previousSidecarPath: canonicalSidecarPath,
    }),
    /ordered transaction payloads/i,
  );

  await writePrivateJson(
    fixture.forgeOutputPath,
    broadcast({
      transactionList: [{ ...transactions[0], hash: `0x${'f'.repeat(64)}` }, transactions[1]],
    }),
  );
  await assert.rejects(
    capture({
      fixture,
      operation: 'resume',
      previousArtifactPath: canonicalArtifactPath,
      previousSidecarPath: canonicalSidecarPath,
    }),
    /dropped-pending transition/i,
  );

  await writePrivateJson(
    fixture.forgeOutputPath,
    broadcast({
      receipts: [],
      pending: [secondPending],
    }),
  );
  await assert.rejects(
    capture({
      fixture,
      operation: 'resume',
      previousArtifactPath: canonicalArtifactPath,
      previousSidecarPath: canonicalSidecarPath,
    }),
    /removed or changed previously recorded receipts/i,
  );

  await writePrivateJson(
    fixture.forgeOutputPath,
    broadcast({
      receipts: [firstReceipt, secondReceipt],
      pending: [
        secondPending,
        {
          transactionHash: `0x${'c'.repeat(64)}`,
          nonce: '0x2',
        },
      ],
    }),
  );
  await assert.rejects(
    capture({
      fixture,
      operation: 'resume',
      previousArtifactPath: canonicalArtifactPath,
      previousSidecarPath: canonicalSidecarPath,
    }),
    /pending entry outside the reviewed input sequence/i,
  );

  await writePrivateJson(
    fixture.forgeOutputPath,
    broadcast({
      receipts: [firstReceipt, secondReceipt],
      pending: [secondPending],
    }),
  );
  await assert.rejects(
    capture({
      fixture,
      operation: 'resume',
      previousArtifactPath: canonicalArtifactPath,
      previousSidecarPath: '-',
    }),
    /guard|both sealed pre-resume recovery artifacts/i,
  );

  const resumed = JSON.parse(
    (
      await capture({
        fixture,
        operation: 'resume',
        previousArtifactPath: canonicalArtifactPath,
        previousSidecarPath: canonicalSidecarPath,
        forgeExitCode: '29',
      })
    ).stdout,
  );
  assert.equal(resumed.changed, true);

  const resumedManifest = await readJson(fixture.manifestPath);
  assert.equal(resumedManifest.deploymentStatus, 'broadcast-transition');
  assert.equal(resumedManifest.broadcastArtifact.resumeAuthorized, false);
  assert.equal(
    resumedManifest.broadcastArtifact.transitionJournal.previousArtifactSha256,
    artifactSha256,
  );
  assert.equal(
    resumedManifest.broadcastArtifact.transitionJournal.previousRecoverySidecarSha256,
    sidecarSha256,
  );

  assert.equal(
    (
      await validate({
        fixture,
        artifactPath: resumed.sealedArtifactPath,
        sidecarPath: resumed.sealedRecoverySidecarPath,
      })
    ).stdout,
    'true',
  );
  await authorizePartialManifest(fixture.manifestPath);
  assert.equal(
    (
      await validate({
        fixture,
        artifactPath: resumed.sealedArtifactPath,
        sidecarPath: resumed.sealedRecoverySidecarPath,
      })
    ).stdout,
    'true',
  );
});

test('resume accepts a dropped pending hash replaced by Foundry with bound evidence', async (context) => {
  const fixture = await createFixture(context, 'resume-replaced-hash');
  const previousOutputBytes = jsonBytes(
    broadcast({
      transactionList: transactions,
      receipts: [firstReceipt],
      pending: [transactions[1].hash],
    }),
  );
  const cacheBytes = jsonBytes(forgeCache());
  const previousArtifactSha256 = sha256(previousOutputBytes);
  const previousSidecarSha256 = sha256(cacheBytes);
  const previousArtifactPath = join(
    fixture.broadcastDirectory,
    `run-${previousArtifactSha256}.json`,
  );
  const previousSidecarPath = join(fixture.cacheDirectory, `run-${previousSidecarSha256}.json`);
  await writePrivate(previousArtifactPath, previousOutputBytes);
  await writePrivate(previousSidecarPath, cacheBytes);
  await begin({
    fixture,
    token: resumeToken,
    operation: 'resume',
    inputArtifactSha256: previousArtifactSha256,
    inputSidecarSha256: previousSidecarSha256,
  });
  await writePrivate(fixture.forgeCachePath, cacheBytes);

  const replacementHash = `0x${'c'.repeat(64)}`;
  await writePrivateJson(
    fixture.forgeOutputPath,
    broadcast({
      transactionList: [transactions[0], { ...transactions[1], hash: replacementHash }],
      receipts: [firstReceipt],
      pending: [replacementHash],
    }),
  );
  const resumed = JSON.parse(
    (
      await capture({
        fixture,
        operation: 'resume',
        previousArtifactPath,
        previousSidecarPath,
      })
    ).stdout,
  );
  assert.equal(resumed.changed, true);

  assert.equal(
    (
      await validate({
        fixture,
        artifactPath: resumed.sealedArtifactPath,
        sidecarPath: resumed.sealedRecoverySidecarPath,
      })
    ).stdout,
    'true',
  );
});

for (const droppedProgression of [
  {
    name: 'seals Foundry dropped-pending state when replacement send fails',
    label: 'resume-dropped-checkpoint',
    previous: () =>
      broadcast({
        transactionList: transactions,
        receipts: [firstReceipt],
        pending: [transactions[1].hash],
      }),
    next: () =>
      broadcast({
        transactionList: transactions,
        receipts: [firstReceipt],
        pending: [],
      }),
  },
  {
    name: 'accepts a later replacement from a reviewed dropped-pending checkpoint',
    label: 'resume-after-dropped-checkpoint',
    previous: () =>
      broadcast({
        transactionList: transactions,
        receipts: [firstReceipt],
        pending: [],
      }),
    next: () => {
      const replacementHash = `0x${'d'.repeat(64)}`;
      return broadcast({
        transactionList: [transactions[0], { ...transactions[1], hash: replacementHash }],
        receipts: [firstReceipt],
        pending: [replacementHash],
      });
    },
  },
]) {
  test(`resume ${droppedProgression.name}`, async (context) => {
    const fixture = await createFixture(context, droppedProgression.label);
    const previousOutputBytes = jsonBytes(droppedProgression.previous());
    const cacheBytes = jsonBytes(forgeCache());
    const previousArtifactSha256 = sha256(previousOutputBytes);
    const previousSidecarSha256 = sha256(cacheBytes);
    const previousArtifactPath = join(
      fixture.broadcastDirectory,
      `run-${previousArtifactSha256}.json`,
    );
    const previousSidecarPath = join(fixture.cacheDirectory, `run-${previousSidecarSha256}.json`);
    await writePrivate(previousArtifactPath, previousOutputBytes);
    await writePrivate(previousSidecarPath, cacheBytes);
    await begin({
      fixture,
      token: resumeToken,
      operation: 'resume',
      inputArtifactSha256: previousArtifactSha256,
      inputSidecarSha256: previousSidecarSha256,
    });
    await writePrivate(fixture.forgeCachePath, cacheBytes);
    await writePrivateJson(fixture.forgeOutputPath, droppedProgression.next());

    const resumed = JSON.parse(
      (
        await capture({
          fixture,
          operation: 'resume',
          previousArtifactPath,
          previousSidecarPath,
        })
      ).stdout,
    );
    assert.equal(resumed.changed, true);
    assert.equal(
      (
        await validate({
          fixture,
          artifactPath: resumed.sealedArtifactPath,
          sidecarPath: resumed.sealedRecoverySidecarPath,
        })
      ).stdout,
      'true',
    );
  });
}

test('resume accepts Foundry null-to-pending transaction hash progression with bound evidence', async (context) => {
  const fixture = await createFixture(context, 'resume-new-hash');
  const previousOutputBytes = jsonBytes(
    broadcast({
      transactionList: [transactions[0], { ...transactions[1], hash: null }],
      receipts: [firstReceipt],
      pending: [],
    }),
  );
  const cacheBytes = jsonBytes(forgeCache());
  const previousArtifactSha256 = sha256(previousOutputBytes);
  const previousSidecarSha256 = sha256(cacheBytes);
  const previousArtifactPath = join(
    fixture.broadcastDirectory,
    `run-${previousArtifactSha256}.json`,
  );
  const previousSidecarPath = join(fixture.cacheDirectory, `run-${previousSidecarSha256}.json`);
  await writePrivate(previousArtifactPath, previousOutputBytes);
  await writePrivate(previousSidecarPath, cacheBytes);
  await begin({
    fixture,
    token: resumeToken,
    operation: 'resume',
    inputArtifactSha256: previousArtifactSha256,
    inputSidecarSha256: previousSidecarSha256,
  });
  await writePrivate(fixture.forgeCachePath, cacheBytes);

  await writePrivateJson(
    fixture.forgeOutputPath,
    broadcast({
      transactionList: transactions,
      receipts: [firstReceipt],
      pending: [],
    }),
  );
  await assert.rejects(
    capture({
      fixture,
      operation: 'resume',
      previousArtifactPath,
      previousSidecarPath,
    }),
    /without pending or receipt evidence/i,
  );

  await writePrivateJson(
    fixture.forgeOutputPath,
    broadcast({
      transactionList: transactions,
      receipts: [firstReceipt],
      pending: [transactions[1].hash],
    }),
  );
  const resumed = JSON.parse(
    (
      await capture({
        fixture,
        operation: 'resume',
        previousArtifactPath,
        previousSidecarPath,
      })
    ).stdout,
  );
  assert.equal(resumed.changed, true);

  const manifest = await readJson(fixture.manifestPath);
  assert.equal(manifest.deploymentStatus, 'broadcast-transition');
  assert.equal(manifest.broadcastArtifact.resumeAuthorized, false);
  assert.equal(
    (
      await validate({
        fixture,
        artifactPath: resumed.sealedArtifactPath,
        sidecarPath: resumed.sealedRecoverySidecarPath,
      })
    ).stdout,
    'true',
  );
});
