import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import test from 'node:test';

const execFileAsync = promisify(execFile);
const scriptsDirectory = dirname(fileURLToPath(import.meta.url));
const extractorPath = join(scriptsDirectory, 'extract-deployment.mjs');
const fixturesDirectory = join(scriptsDirectory, 'fixtures', 'deployments');
const sourceCommit = '1234567890abcdef1234567890abcdef12345678';

const deploymentEnvironmentNames = [
  'DEPLOYMENT_SOURCE_COMMIT',
  'DEPLOYMENT_RPC_URL',
  'DEPLOYMENT_EXPLORER_BASE_URL',
  'DEPLOYMENT_VERIFIER_URL',
  'DEPLOYMENT_VERIFICATION_REQUESTED',
  'DEPLOYMENT_QUERY_ONCHAIN_CONFIGURATION',
  'DEPLOYMENT_SCOPE_DIRTY',
  'DEPLOYMENT_FULL_TREE_DIRTY',
  'DEPLOYER_ADDRESS',
  'ADAPTER_MANAGER_ADDRESS',
  'PLATFORM_FEE_RECIPIENT',
  'PLATFORM_FEE_BPS',
  'PRODUCTION_MODE',
  'DEPLOY_TEST_MOCKS',
  'DEPLOYER_BALANCE_WEI',
];

function cleanEnvironment(overrides = {}) {
  const environment = { ...process.env };
  for (const name of deploymentEnvironmentNames) delete environment[name];
  return { ...environment, ...overrides };
}

async function runExtractor({
  fixture,
  output,
  mode = 'giwa-sepolia',
  publicManifest = true,
  environment = {},
  chainId = '91342',
  extraArguments = [],
}) {
  const argumentsList = [
    extractorPath,
    isAbsolute(fixture) ? fixture : resolve(fixturesDirectory, fixture),
    output,
    chainId,
    mode,
  ];
  if (publicManifest) argumentsList.push('--public');
  argumentsList.push(...extraArguments);
  return execFileAsync(process.execPath, argumentsList, {
    env: cleanEnvironment(environment),
  });
}

test('keeps the legacy local demo manifest shape and mock address map', async (context) => {
  const directory = await mkdtemp(join(tmpdir(), 'giwapay-manifest-'));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const output = join(directory, 'local.json');

  await runExtractor({
    fixture: 'local-mocks.json',
    output,
    mode: 'local-anvil',
    publicManifest: false,
  });
  const manifest = JSON.parse(await readFile(output, 'utf8'));

  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.mode, 'local-anvil');
  assert.equal(manifest.contracts.paymentRouter, '0x3333333333333333333333333333333333333333');
  assert.equal(
    manifest.contracts.mockExactOutputAdapter,
    '0x8888888888888888888888888888888888888888',
  );
  assert.match(manifest.sourceBroadcast, /local-mocks\.json$/);
});

test('emits sanitized complete public evidence and uses receipt-address correlation', async (context) => {
  const directory = await mkdtemp(join(tmpdir(), 'giwapay-manifest-'));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const output = join(directory, 'public.json');

  await runExtractor({
    fixture: 'core-success.json',
    output,
    environment: {
      DEPLOYMENT_SOURCE_COMMIT: sourceCommit,
      DEPLOYMENT_VERIFICATION_REQUESTED: 'true',
      DEPLOYER_ADDRESS: '0x4444444444444444444444444444444444444444',
      ADAPTER_MANAGER_ADDRESS: '0x5555555555555555555555555555555555555555',
      PLATFORM_FEE_RECIPIENT: '0x6666666666666666666666666666666666666666',
      PLATFORM_FEE_BPS: '50',
      PRODUCTION_MODE: 'true',
      DEPLOY_TEST_MOCKS: 'false',
      DEPLOYER_BALANCE_WEI: '1000000000000000000',
    },
  });
  const manifest = JSON.parse(await readFile(output, 'utf8'));

  assert.equal(manifest.schemaVersion, 2);
  assert.equal(manifest.deploymentStatus, 'broadcast-complete');
  assert.equal(manifest.sourceCommit, sourceCommit);
  assert.equal(manifest.broadcastArtifact.sourceCommit, sourceCommit.slice(0, 7));
  assert.equal(manifest.earliestIndexedBlock, '100');
  assert.equal(manifest.configuration.platformFeeBps, 50);
  assert.equal(manifest.configuration.productionMode, true);
  assert.equal(manifest.verification.status, 'requested-unconfirmed');
  assert.equal(
    manifest.contractEvidence.merchantRegistry.transactionHash,
    `0x${'d'.repeat(64)}`,
    'receipt transaction hash is authoritative even when the CREATE entry reports another hash',
  );
  assert.equal(manifest.sourceBroadcast, undefined);
  assert.doesNotMatch(JSON.stringify(manifest), /GIWAPAY_DEPLOYER_ACCOUNT|sepolia-rpc/);
});

test('records partial broadcast evidence without claiming completion or verification', async (context) => {
  const directory = await mkdtemp(join(tmpdir(), 'giwapay-manifest-'));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const output = join(directory, 'partial.json');

  await runExtractor({
    fixture: 'partial-broadcast.json',
    output,
    environment: {
      DEPLOYMENT_SOURCE_COMMIT: sourceCommit,
      DEPLOYMENT_VERIFICATION_REQUESTED: 'false',
    },
  });
  const manifest = JSON.parse(await readFile(output, 'utf8'));

  assert.equal(manifest.deploymentStatus, 'broadcast-partial');
  assert.equal(manifest.contracts.paymentRouter, undefined);
  assert.equal(manifest.contractEvidence.adapterRegistry.receiptStatus, 'unavailable');
  assert.equal(manifest.configuration.deployTestMocks, null);
  assert.equal(manifest.mockReadiness.status, 'unknown');
  assert.equal(manifest.verification.status, 'not-requested');
});

test('does not infer no-mock mode from an otherwise complete core broadcast', async (context) => {
  const directory = await mkdtemp(join(tmpdir(), 'giwapay-manifest-'));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const output = join(directory, 'unknown-mock-mode.json');

  await runExtractor({
    fixture: 'core-success.json',
    output,
    environment: {
      DEPLOYMENT_SOURCE_COMMIT: sourceCommit,
    },
  });
  const manifest = JSON.parse(await readFile(output, 'utf8'));

  assert.equal(manifest.configuration.deployTestMocks, null);
  assert.equal(manifest.mockReadiness.status, 'unknown');
  assert.equal(manifest.deploymentStatus, 'broadcast-partial');
});

test('records mock deployments as not proven rather than ready', async (context) => {
  const directory = await mkdtemp(join(tmpdir(), 'giwapay-manifest-'));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const output = join(directory, 'mock-readiness.json');

  await runExtractor({
    fixture: 'local-mocks.json',
    output,
    environment: {
      DEPLOYMENT_SOURCE_COMMIT: sourceCommit,
    },
  });
  const manifest = JSON.parse(await readFile(output, 'utf8'));

  assert.equal(manifest.configuration.deployTestMocks, true);
  assert.equal(manifest.mockReadiness.status, 'not-proven');
  assert.equal(manifest.deploymentStatus, 'broadcast-partial');
});

test('requires success receipts for non-CREATE calls and no pending transactions', async (context) => {
  const directory = await mkdtemp(join(tmpdir(), 'giwapay-manifest-'));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const fixture = JSON.parse(await readFile(join(fixturesDirectory, 'core-success.json'), 'utf8'));
  fixture.receipts.at(-1).status = '0x0';
  const failedCallFixture = join(directory, 'failed-call.json');
  await writeFile(failedCallFixture, `${JSON.stringify(fixture)}\n`);

  const output = join(directory, 'failed-call-manifest.json');
  await runExtractor({
    fixture: failedCallFixture,
    output,
    environment: {
      DEPLOYMENT_SOURCE_COMMIT: sourceCommit,
      DEPLOY_TEST_MOCKS: 'false',
    },
  });
  assert.equal(JSON.parse(await readFile(output, 'utf8')).deploymentStatus, 'evidence-conflict');

  fixture.receipts.at(-1).status = '0x1';
  fixture.pending = [`0x${'f'.repeat(64)}`];
  const pendingFixture = join(directory, 'pending.json');
  await writeFile(pendingFixture, `${JSON.stringify(fixture)}\n`);
  await runExtractor({
    fixture: pendingFixture,
    output,
    environment: {
      DEPLOYMENT_SOURCE_COMMIT: sourceCommit,
      DEPLOY_TEST_MOCKS: 'false',
    },
  });
  assert.equal(JSON.parse(await readFile(output, 'utf8')).deploymentStatus, 'broadcast-partial');

  fixture.pending = [];
  fixture.receipts.at(-1).transactionHash = `0x${'8'.repeat(64)}`;
  const unmatchedCallReceiptFixture = join(directory, 'unmatched-call-receipt.json');
  await writeFile(unmatchedCallReceiptFixture, `${JSON.stringify(fixture)}\n`);
  await runExtractor({
    fixture: unmatchedCallReceiptFixture,
    output,
    environment: {
      DEPLOYMENT_SOURCE_COMMIT: sourceCommit,
      DEPLOY_TEST_MOCKS: 'false',
    },
  });
  assert.equal(JSON.parse(await readFile(output, 'utf8')).deploymentStatus, 'broadcast-partial');

  fixture.receipts.at(-1).transactionHash = `0x${'9'.repeat(64)}`;
  delete fixture.pending;
  const unknownPendingFixture = join(directory, 'unknown-pending.json');
  await writeFile(unknownPendingFixture, `${JSON.stringify(fixture)}\n`);
  await runExtractor({
    fixture: unknownPendingFixture,
    output,
    environment: {
      DEPLOYMENT_SOURCE_COMMIT: sourceCommit,
      DEPLOY_TEST_MOCKS: 'false',
    },
  });
  assert.equal(JSON.parse(await readFile(output, 'utf8')).deploymentStatus, 'broadcast-partial');
});

test('reconcile comparison cannot overwrite recorded configuration', async (context) => {
  const directory = await mkdtemp(join(tmpdir(), 'giwapay-manifest-'));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const output = join(directory, 'recorded.json');
  const baseEnvironment = {
    DEPLOYMENT_SOURCE_COMMIT: sourceCommit,
    DEPLOYER_ADDRESS: '0x4444444444444444444444444444444444444444',
    ADAPTER_MANAGER_ADDRESS: '0x5555555555555555555555555555555555555555',
    PLATFORM_FEE_RECIPIENT: '0x6666666666666666666666666666666666666666',
    PLATFORM_FEE_BPS: '50',
    PRODUCTION_MODE: 'true',
    DEPLOY_TEST_MOCKS: 'false',
  };
  await runExtractor({
    fixture: 'core-success.json',
    output,
    environment: baseEnvironment,
  });
  await runExtractor({
    fixture: 'core-success.json',
    output,
    environment: { ...baseEnvironment, PLATFORM_FEE_BPS: '75' },
  });
  const manifest = JSON.parse(await readFile(output, 'utf8'));

  assert.equal(manifest.configuration.platformFeeBps, 50);
  assert.equal(manifest.deploymentStatus, 'evidence-conflict');
  assert.match(manifest.configurationConflicts.join(' '), /platformFeeBps/);
});

test('marks a Foundry/source commit mismatch as conflicting evidence', async (context) => {
  const directory = await mkdtemp(join(tmpdir(), 'giwapay-manifest-'));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const output = join(directory, 'mismatch.json');

  await runExtractor({
    fixture: 'core-success.json',
    output,
    environment: {
      DEPLOYMENT_SOURCE_COMMIT: 'ffffffffffffffffffffffffffffffffffffffff',
    },
  });
  const manifest = JSON.parse(await readFile(output, 'utf8'));

  assert.equal(manifest.deploymentStatus, 'evidence-conflict');
  assert.match(manifest.notes.join(' '), /broadcast commit does not match/i);
});

test('confirms runtime code hashes and explorer verification only from live query evidence', async (context) => {
  const codeHash = `0x${'9'.repeat(64)}`;
  const server = createServer(async (request, response) => {
    if (request.method === 'POST') {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      let result = null;
      if (payload.method === 'eth_getCode') result = '0x60006000';
      if (payload.method === 'eth_getProof') result = { codeHash };
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({ jsonrpc: '2.0', id: payload.id, result }));
      return;
    }
    response.setHeader('content-type', 'application/json');
    response.end(
      JSON.stringify({
        status: '1',
        message: 'OK',
        result: [{ SourceCode: 'contract VerifiedFixture {}', ABI: '[]' }],
      }),
    );
  });
  await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
  context.after(() => new Promise((resolveClose) => server.close(resolveClose)));
  const address = server.address();
  const queryUrl = `http://127.0.0.1:${address.port}`;

  const directory = await mkdtemp(join(tmpdir(), 'giwapay-manifest-'));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const output = join(directory, 'queried.json');
  await runExtractor({
    fixture: 'core-success.json',
    output,
    environment: {
      DEPLOYMENT_SOURCE_COMMIT: sourceCommit,
      DEPLOYMENT_RPC_URL: queryUrl,
      DEPLOYMENT_VERIFIER_URL: `${queryUrl}/api`,
      DEPLOYMENT_VERIFICATION_REQUESTED: 'true',
      DEPLOY_TEST_MOCKS: 'false',
    },
  });
  const manifest = JSON.parse(await readFile(output, 'utf8'));

  assert.equal(manifest.contractEvidence.paymentRouter.runtimeCodeHash, codeHash);
  assert.equal(manifest.contractEvidence.paymentRouter.runtimeCodeStatus, 'confirmed');
  assert.equal(manifest.verification.status, 'verified');
  assert.equal(manifest.verification.contracts.paymentRouter.status, 'verified');
});

test('rejects chain/source ambiguity and preserves an existing public manifest', async (context) => {
  const directory = await mkdtemp(join(tmpdir(), 'giwapay-manifest-'));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const output = join(directory, 'sentinel.json');
  const sentinel = '{"sentinel":true}\n';
  await writeFile(output, sentinel);

  await assert.rejects(
    runExtractor({
      fixture: 'core-success.json',
      output,
      chainId: '1',
      environment: { DEPLOYMENT_SOURCE_COMMIT: sourceCommit },
    }),
  );
  assert.equal(await readFile(output, 'utf8'), sentinel);

  await assert.rejects(
    runExtractor({
      fixture: 'core-success.json',
      output,
      environment: { DEPLOYMENT_SOURCE_COMMIT: 'short' },
    }),
  );
  assert.equal(await readFile(output, 'utf8'), sentinel);
});

test('rejects unknown public extractor options', async (context) => {
  const directory = await mkdtemp(join(tmpdir(), 'giwapay-manifest-'));
  context.after(() => rm(directory, { recursive: true, force: true }));

  await assert.rejects(
    runExtractor({
      fixture: 'core-success.json',
      output: join(directory, 'unknown.json'),
      environment: { DEPLOYMENT_SOURCE_COMMIT: sourceCommit },
      extraArguments: ['--unexpected'],
    }),
  );
});
