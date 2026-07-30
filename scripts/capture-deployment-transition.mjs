import { Buffer } from 'node:buffer';
import { createHash, randomUUID } from 'node:crypto';
import {
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import process from 'node:process';

const sha256Pattern = /^[0-9a-f]{64}$/;
const commitPattern = /^[0-9a-fA-F]{40}$/;
const addressPattern = /^0x[0-9a-fA-F]{40}$/;
const tokenPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const guardFileName = 'giwapay-deployment-91342-inflight.json';
const forgeVersion = '1.7.1';
const forgeCommit = '4072e48705af9d93e3c0f6e29e93b5e9a40caed8';

const [command, ...arguments_] = process.argv.slice(2);
if (command === 'capture') {
  captureTransition(arguments_);
} else if (command === 'validate') {
  validateTransition(arguments_);
} else if (command === 'begin') {
  beginTransition(arguments_);
} else if (command === 'complete') {
  completeTransition(arguments_);
} else {
  throw new Error(
    'Usage: capture-deployment-transition.mjs begin|capture|validate|complete <command arguments>',
  );
}

function beginTransition(argumentsList) {
  const [
    canonicalContractsRoot,
    canonicalBroadcastDirectory,
    canonicalRecoveryCacheDirectory,
    guardPathValue,
    attemptToken,
    operation,
    sourceCommit,
    evidenceToolingCommit,
    inputArtifactSha256,
    inputRecoverySidecarSha256,
    sealedWorkspaceValue,
    fullTreeDirtyValue,
    rpcUrlSha256,
  ] = argumentsList;
  if (
    argumentsList.length !== 13 ||
    !canonicalContractsRoot ||
    !canonicalBroadcastDirectory ||
    !canonicalRecoveryCacheDirectory ||
    !guardPathValue ||
    !tokenPattern.test(attemptToken ?? '') ||
    !['deploy', 'resume'].includes(operation) ||
    !commitPattern.test(sourceCommit ?? '') ||
    !commitPattern.test(evidenceToolingCommit ?? '') ||
    !isOptionalDigest(inputArtifactSha256) ||
    !isOptionalDigest(inputRecoverySidecarSha256) ||
    (operation === 'deploy' && inputArtifactSha256 !== 'none') ||
    (operation === 'deploy' && inputRecoverySidecarSha256 !== 'none') ||
    (operation === 'resume' && inputArtifactSha256 === 'none') ||
    (operation === 'resume' && inputRecoverySidecarSha256 === 'none') ||
    !sealedWorkspaceValue ||
    !['true', 'false'].includes(fullTreeDirtyValue) ||
    !sha256Pattern.test(rpcUrlSha256 ?? '')
  ) {
    throw new Error('Malformed begin transition arguments');
  }

  const canonicalRoot = realpathSync(resolve(canonicalContractsRoot));
  assertActiveWrapperLock(canonicalRoot, {
    expectedToken: attemptToken,
    expectedOperations: [operation],
  });
  assertSafeStorageDirectory(canonicalRoot, canonicalBroadcastDirectory);
  assertSafeStorageDirectory(canonicalRoot, canonicalRecoveryCacheDirectory);
  const guardPath = assertGuardPath(guardPathValue);
  const sealedWorkspace = assertPrivateDirectory(sealedWorkspaceValue);
  const sealedWorkspaceParent = realpathSync(dirname(sealedWorkspace));
  const sealedWorkspaceName = basename(sealedWorkspace);
  if (
    !/^giwapay-reviewed-deploy\.[A-Za-z0-9]+$/.test(sealedWorkspaceName) ||
    join(sealedWorkspaceParent, sealedWorkspaceName) !== sealedWorkspace
  ) {
    throw new Error('Sealed workspace is outside the reviewed temporary-directory boundary');
  }
  const guard = {
    schemaVersion: 1,
    project: 'GiwaPay',
    chainId: 91342,
    attemptToken,
    operation,
    sourceCommit: sourceCommit.toLowerCase(),
    signingEvidenceToolingCommit: evidenceToolingCommit.toLowerCase(),
    inputArtifactSha256: inputArtifactSha256 === 'none' ? null : inputArtifactSha256,
    inputRecoverySidecarSha256:
      inputRecoverySidecarSha256 === 'none' ? null : inputRecoverySidecarSha256,
    expectedRpcUrlSha256: rpcUrlSha256,
    sealedWorkspace,
    sealedWorkspaceParent,
    sealedWorkspaceName,
    fullTreeDirty: fullTreeDirtyValue === 'true',
    configuration: readConfigurationFromEnvironment(),
    startedAt: new Date().toISOString(),
  };
  storeImmutable(guardPath, Buffer.from(`${JSON.stringify(guard, null, 2)}\n`), 0o600);
  process.stdout.write(guardPath);
}

function completeTransition(argumentsList) {
  const [guardPathValue, expectedToken] = argumentsList;
  if (argumentsList.length !== 2 || !guardPathValue || !tokenPattern.test(expectedToken ?? '')) {
    throw new Error('Malformed complete transition arguments');
  }
  const guardPath = assertGuardPath(guardPathValue);
  const guard = readGuard(guardPath);
  if (guard.attemptToken !== expectedToken) {
    throw new Error('In-flight guard ownership token differs');
  }
  assertActiveWrapperLock(dirname(guardPath), {
    expectedOperations: ['deploy', 'resume', 'reconcile', 'verify'],
  });
  const workspace = validateCleanupWorkspace(guard);

  // Once reviewed reconciliation has made this transition closable, the guard
  // is the authoritative signing block. Remove and fsync it before treating the
  // preserved workspace as disposable, so a crash cannot leave a live guard
  // pointing at an already-deleted recovery workspace.
  rmSync(guardPath);
  fsyncDirectory(dirname(guardPath));
  if (workspace !== null) {
    try {
      rmSync(workspace, { recursive: true });
      fsyncDirectory(guard.sealedWorkspaceParent);
    } catch (error) {
      process.stderr.write(
        `Closed the in-flight guard, but preserved workspace cleanup needs manual review: ${error.message}\n`,
      );
    }
  }
}

function captureTransition(argumentsList) {
  const [
    manifestPath,
    forgeOutputPath,
    forgeCachePath,
    previousArtifactPathValue,
    previousRecoverySidecarPathValue,
    canonicalContractsRoot,
    canonicalBroadcastDirectory,
    canonicalRecoveryCacheDirectory,
    sealedEvidenceDirectory,
    guardPathValue,
    operation,
    forgeExitCodeValue,
    sourceCommit,
    evidenceToolingCommit,
    fullTreeDirtyValue,
  ] = argumentsList;
  if (
    argumentsList.length !== 15 ||
    !manifestPath ||
    !forgeOutputPath ||
    !forgeCachePath ||
    !canonicalContractsRoot ||
    !canonicalBroadcastDirectory ||
    !canonicalRecoveryCacheDirectory ||
    !sealedEvidenceDirectory ||
    !guardPathValue ||
    !['deploy', 'resume'].includes(operation) ||
    !/^\d+$/.test(forgeExitCodeValue ?? '') ||
    !commitPattern.test(sourceCommit ?? '') ||
    !commitPattern.test(evidenceToolingCommit ?? '') ||
    !['true', 'false'].includes(fullTreeDirtyValue)
  ) {
    throw new Error('Malformed capture transition arguments');
  }

  const guardPath = assertGuardPath(guardPathValue);
  const guardBytes = readPrivateFile(guardPath, 'in-flight deployment guard');
  const guard = parseGuard(guardBytes);
  assertActiveWrapperLock(realpathSync(resolve(canonicalContractsRoot)), {
    expectedToken: Number(forgeExitCodeValue) === 255 ? undefined : guard.attemptToken,
    expectedOperations: Number(forgeExitCodeValue) === 255 ? ['reconcile'] : [guard.operation],
  });
  const previousArtifactPath = previousArtifactPathValue === '-' ? null : previousArtifactPathValue;
  const previousRecoverySidecarPath =
    previousRecoverySidecarPathValue === '-' ? null : previousRecoverySidecarPathValue;
  const previousDigest = previousArtifactPath
    ? digest(readPrivateFile(previousArtifactPath, 'sealed pre-resume broadcast artifact'))
    : null;
  const previousRecoverySidecarDigest = previousRecoverySidecarPath
    ? digest(readPrivateFile(previousRecoverySidecarPath, 'sealed pre-resume recovery sidecar'))
    : null;
  const toolingMatchesSigningGuard =
    guard.signingEvidenceToolingCommit === evidenceToolingCommit.toLowerCase();
  const reviewedRecoveryUpgrade =
    Number(forgeExitCodeValue) === 255 && commitPattern.test(evidenceToolingCommit);
  if (
    guard.operation !== operation ||
    guard.sourceCommit !== sourceCommit.toLowerCase() ||
    (!toolingMatchesSigningGuard && !reviewedRecoveryUpgrade) ||
    guard.inputArtifactSha256 !== previousDigest ||
    guard.inputRecoverySidecarSha256 !== previousRecoverySidecarDigest ||
    guard.fullTreeDirty !== (fullTreeDirtyValue === 'true') ||
    !isPathInside(guard.sealedWorkspace, manifestPath) ||
    !isPathInside(guard.sealedWorkspace, forgeOutputPath) ||
    !isPathInside(guard.sealedWorkspace, forgeCachePath) ||
    !isPathInside(guard.sealedWorkspace, sealedEvidenceDirectory)
  ) {
    throw new Error('In-flight deployment guard does not bind this sealed transition');
  }
  assertConfigurationMatchesEnvironment(guard.configuration);

  captureBoundTransition({
    manifestPath,
    forgeOutputPath,
    forgeCachePath,
    previousArtifactPath,
    previousRecoverySidecarPath,
    canonicalContractsRoot,
    canonicalBroadcastDirectory,
    canonicalRecoveryCacheDirectory,
    sealedEvidenceDirectory,
    guardPath,
    guardBytes,
    guard,
    operation,
    forgeExitCode: Number(forgeExitCodeValue),
    sourceCommit,
    evidenceToolingCommit,
    recoveredAfterInterruption: reviewedRecoveryUpgrade,
  });
}

function captureBoundTransition({
  manifestPath,
  forgeOutputPath,
  forgeCachePath,
  previousArtifactPath,
  previousRecoverySidecarPath,
  canonicalContractsRoot,
  canonicalBroadcastDirectory,
  canonicalRecoveryCacheDirectory,
  sealedEvidenceDirectory,
  guardPath,
  guardBytes,
  guard,
  operation,
  forgeExitCode,
  sourceCommit,
  evidenceToolingCommit,
  recoveredAfterInterruption,
}) {
  const outputBytes = readPrivateFile(forgeOutputPath, 'Forge broadcast output');
  const cacheBytes = readPrivateFile(forgeCachePath, 'Forge sensitive recovery cache');
  const outputDigest = digest(outputBytes);
  const output = parseBroadcast(outputBytes, sourceCommit);
  const privateCacheEvidence = validatePrivateCache(
    cacheBytes,
    output.transactions.length,
    guard.expectedRpcUrlSha256,
  );

  let previousDigest = null;
  let previousRecoverySidecarDigest = null;
  if (operation === 'resume') {
    if (!previousArtifactPath || !previousRecoverySidecarPath) {
      throw new Error('Resume transition requires both sealed pre-resume recovery artifacts');
    }
    const previousBytes = readPrivateFile(
      previousArtifactPath,
      'sealed pre-resume broadcast artifact',
    );
    previousDigest = digest(previousBytes);
    const previousRecoverySidecarBytes = readPrivateFile(
      previousRecoverySidecarPath,
      'sealed pre-resume recovery sidecar',
    );
    previousRecoverySidecarDigest = digest(previousRecoverySidecarBytes);
    validatePrivateCache(
      previousRecoverySidecarBytes,
      output.transactions.length,
      guard.expectedRpcUrlSha256,
    );
    const previous = parseBroadcast(previousBytes, sourceCommit);
    assertMonotonicResume(previous, output);
    if (previousDigest === outputDigest) {
      process.stdout.write(
        `${JSON.stringify({
          changed: false,
          sha256: outputDigest,
          attemptToken: guard.attemptToken,
        })}\n`,
      );
      return;
    }
  }

  const canonicalDirectory = assertSafeStorageDirectory(
    canonicalContractsRoot,
    canonicalBroadcastDirectory,
  );
  const canonicalPrivateDirectory = assertSafeStorageDirectory(
    canonicalContractsRoot,
    canonicalRecoveryCacheDirectory,
  );
  const artifactFileName = `run-${outputDigest}.json`;
  const recoverySidecarFileName = `run-${privateCacheEvidence.sha256}.json`;
  storeImmutable(join(canonicalDirectory, artifactFileName), outputBytes, 0o600);
  storeImmutable(join(canonicalPrivateDirectory, recoverySidecarFileName), cacheBytes, 0o600);

  const sealedEvidenceRoot = assertPrivateDirectory(sealedEvidenceDirectory);
  const sealedArtifactPath = join(sealedEvidenceRoot, artifactFileName);
  storeImmutable(sealedArtifactPath, outputBytes, 0o600);
  const sealedPrivateDirectory = assertPrivateDirectory(join(sealedEvidenceRoot, 'private'));
  const sealedRecoverySidecarPath = join(sealedPrivateDirectory, recoverySidecarFileName);
  storeImmutable(sealedRecoverySidecarPath, cacheBytes, 0o600);

  const manifest = JSON.parse(readPrivateFile(manifestPath, 'sealed manifest').toString('utf8'));
  const guardDigest = digest(guardBytes);
  const recoverySidecar = {
    fileName: recoverySidecarFileName,
    sha256: privateCacheEvidence.sha256,
    publicArtifactSha256: outputDigest,
    rpcUrlSha256: guard.expectedRpcUrlSha256,
    storage: 'foundry-cache-private',
  };
  const resumePolicy = {
    schemaVersion: 1,
    kind: 'content-addressed-foundry-sensitive-sequence',
    forgeVersion,
    forgeCommit,
    rpcUrlSha256: guard.expectedRpcUrlSha256,
    transactionCount: output.transactions.length,
    recoverySidecarSha256: privateCacheEvidence.sha256,
  };
  const journal = {
    schemaVersion: 1,
    project: 'GiwaPay',
    chainId: 91342,
    operation,
    sourceCommit: sourceCommit.toLowerCase(),
    signingEvidenceToolingCommit: guard.signingEvidenceToolingCommit,
    evidenceToolingCommit: evidenceToolingCommit.toLowerCase(),
    previousArtifactSha256: previousDigest,
    previousRecoverySidecarSha256: previousRecoverySidecarDigest,
    nextArtifact: {
      fileName: artifactFileName,
      sha256: outputDigest,
      sourceCommit: output.commit.toLowerCase(),
      transactionCount: output.transactions.length,
      receiptCount: Array.isArray(output.receipts) ? output.receipts.length : 0,
      pendingCount: Array.isArray(output.pending) ? output.pending.length : null,
    },
    resumePolicy,
    privateCacheEvidence: {
      ...privateCacheEvidence,
      fileName: recoverySidecarFileName,
      persisted: true,
    },
    inflightGuard: {
      fileName: basename(guardPath),
      sha256: guardDigest,
      record: guard,
    },
    forgeExitCode,
    recoveredAfterInterruption,
    resumeAuthorizationProvenance: 'sealed-reviewed-wrapper-transition',
    recordedAt: new Date().toISOString(),
  };
  const journalBytes = Buffer.from(`${JSON.stringify(journal, null, 2)}\n`);
  const journalDigest = digest(journalBytes);
  const journalFileName = `transition-${journalDigest}.json`;
  storeImmutable(join(canonicalDirectory, journalFileName), journalBytes, 0o600);

  const previousNotes = Array.isArray(manifest.notes) ? manifest.notes : [];
  const transitionManifest = {
    ...manifest,
    schemaVersion: 2,
    project: 'GiwaPay',
    chainId: 91342,
    mode: 'giwa-sepolia',
    generatedAt: new Date().toISOString(),
    deploymentStatus: 'broadcast-transition',
    sourceCommit: sourceCommit.toLowerCase(),
    evidenceToolingCommit: evidenceToolingCommit.toLowerCase(),
    deploymentScopeDirty: false,
    fullTreeDirty: guard.fullTreeDirty,
    broadcastArtifact: {
      fileName: artifactFileName,
      sha256: outputDigest,
      sourceCommit: output.commit.toLowerCase(),
      resumeAuthorized: false,
      transactionCount: output.transactions.length,
      receiptCount: Array.isArray(output.receipts) ? output.receipts.length : 0,
      resumePolicy,
      recoverySidecar,
      transitionJournal: {
        fileName: journalFileName,
        sha256: journalDigest,
        operation,
        previousArtifactSha256: previousDigest,
        previousRecoverySidecarSha256: previousRecoverySidecarDigest,
        inflightGuardSha256: guardDigest,
        signingEvidenceToolingCommit: guard.signingEvidenceToolingCommit,
        evidenceToolingCommit: evidenceToolingCommit.toLowerCase(),
      },
    },
    configuration: guard.configuration,
    configurationConflicts: [],
    verification: {
      requested: false,
      status: 'not-requested',
      contracts: {},
    },
    notes: [
      ...new Set([
        ...previousNotes,
        'Forge produced a sealed broadcast transition; full public evidence extraction is pending.',
        'Resume requires a private content-addressed Foundry cache sidecar whose RPC sequence matches the reviewed endpoint.',
      ]),
    ],
  };
  writeJsonAtomically(manifestPath, transitionManifest, 0o600);
  process.stdout.write(
    `${JSON.stringify({
      changed: true,
      sha256: outputDigest,
      artifactFileName,
      sealedArtifactPath,
      sealedRecoverySidecarPath,
      journalFileName,
      journalSha256: journalDigest,
      attemptToken: guard.attemptToken,
    })}\n`,
  );
}

function validateTransition(argumentsList) {
  const [
    manifestPath,
    artifactPath,
    recoverySidecarPath,
    canonicalContractsRoot,
    canonicalBroadcastDirectory,
    canonicalRecoveryCacheDirectory,
    currentRpcUrlSha256,
  ] = argumentsList;
  if (
    argumentsList.length !== 7 ||
    !manifestPath ||
    !artifactPath ||
    !recoverySidecarPath ||
    !canonicalContractsRoot ||
    !canonicalBroadcastDirectory ||
    !canonicalRecoveryCacheDirectory ||
    !sha256Pattern.test(currentRpcUrlSha256 ?? '')
  ) {
    throw new Error('Malformed validate transition arguments');
  }

  const canonicalRoot = realpathSync(resolve(canonicalContractsRoot));
  assertActiveWrapperLock(canonicalRoot, {
    expectedOperations: ['deploy', 'resume', 'reconcile', 'verify'],
  });
  const manifest = JSON.parse(readPrivateFile(manifestPath, 'sealed manifest').toString('utf8'));
  const artifactBytes = readPrivateFile(artifactPath, 'sealed broadcast artifact');
  const artifactDigest = digest(artifactBytes);
  const recoverySidecarBytes = readPrivateFile(
    recoverySidecarPath,
    'sealed private recovery sidecar',
  );
  const recoverySidecarDigest = digest(recoverySidecarBytes);
  const artifact = parseBroadcast(artifactBytes, manifest.sourceCommit ?? '');
  const broadcastReference = manifest.broadcastArtifact;
  const resumePolicy = broadcastReference?.resumePolicy;
  const recoverySidecarReference = broadcastReference?.recoverySidecar;
  const journalReference = broadcastReference?.transitionJournal;
  const validAuthorizationState =
    (manifest.deploymentStatus === 'broadcast-transition' &&
      broadcastReference?.resumeAuthorized === false) ||
    (manifest.deploymentStatus === 'broadcast-partial' &&
      broadcastReference?.resumeAuthorized === true) ||
    (manifest.deploymentStatus === 'broadcast-complete' &&
      broadcastReference?.resumeAuthorized === false);
  if (
    manifest.schemaVersion !== 2 ||
    manifest.chainId !== 91342 ||
    manifest.mode !== 'giwa-sepolia' ||
    !['broadcast-transition', 'broadcast-partial', 'broadcast-complete'].includes(
      manifest.deploymentStatus,
    ) ||
    manifest.deploymentScopeDirty !== false ||
    !validAuthorizationState ||
    broadcastReference?.sha256 !== artifactDigest ||
    broadcastReference?.fileName !== basename(artifactPath) ||
    broadcastReference?.fileName !== `run-${artifactDigest}.json` ||
    broadcastReference?.sourceCommit !== artifact.commit.toLowerCase() ||
    !commitPattern.test(manifest.sourceCommit ?? '') ||
    !commitPattern.test(manifest.evidenceToolingCommit ?? '') ||
    !isValidResumePolicy(resumePolicy, artifactDigest, artifact.transactions.length) ||
    resumePolicy.recoverySidecarSha256 !== recoverySidecarDigest ||
    resumePolicy.rpcUrlSha256 !== currentRpcUrlSha256 ||
    recoverySidecarReference?.fileName !== basename(recoverySidecarPath) ||
    recoverySidecarReference?.fileName !== `run-${recoverySidecarDigest}.json` ||
    recoverySidecarReference?.sha256 !== recoverySidecarDigest ||
    recoverySidecarReference?.publicArtifactSha256 !== artifactDigest ||
    recoverySidecarReference?.rpcUrlSha256 !== resumePolicy.rpcUrlSha256 ||
    recoverySidecarReference?.storage !== 'foundry-cache-private' ||
    !journalReference ||
    !/^transition-[0-9a-f]{64}\.json$/.test(journalReference.fileName ?? '') ||
    !sha256Pattern.test(journalReference.sha256 ?? '') ||
    !['deploy', 'resume'].includes(journalReference.operation) ||
    !isNullableDigest(journalReference.previousArtifactSha256) ||
    !isNullableDigest(journalReference.previousRecoverySidecarSha256) ||
    !sha256Pattern.test(journalReference.inflightGuardSha256 ?? '') ||
    !commitPattern.test(journalReference.signingEvidenceToolingCommit ?? '') ||
    !commitPattern.test(journalReference.evidenceToolingCommit ?? '')
  ) {
    throw new Error('Committed transition manifest is not eligible for resume authorization');
  }

  const canonicalDirectory = assertSafeStorageDirectory(
    canonicalContractsRoot,
    canonicalBroadcastDirectory,
  );
  const canonicalArtifactBytes = readPrivateFile(
    join(canonicalDirectory, broadcastReference.fileName),
    'canonical broadcast artifact',
  );
  const canonicalPrivateDirectory = assertSafeStorageDirectory(
    canonicalContractsRoot,
    canonicalRecoveryCacheDirectory,
  );
  const canonicalRecoverySidecarBytes = readPrivateFile(
    join(canonicalPrivateDirectory, recoverySidecarReference.fileName),
    'canonical private recovery sidecar',
  );
  if (!canonicalArtifactBytes.equals(artifactBytes)) {
    throw new Error('Canonical broadcast artifact differs from the sealed reviewed snapshot');
  }
  if (!canonicalRecoverySidecarBytes.equals(recoverySidecarBytes)) {
    throw new Error('Canonical private recovery sidecar differs from the sealed reviewed snapshot');
  }
  validatePrivateCache(recoverySidecarBytes, artifact.transactions.length, currentRpcUrlSha256);

  const journalBytes = readPrivateFile(
    join(canonicalDirectory, journalReference.fileName),
    'transition journal',
  );
  if (digest(journalBytes) !== journalReference.sha256) {
    throw new Error('Transition journal SHA-256 differs from the committed manifest');
  }
  const journal = JSON.parse(journalBytes.toString('utf8'));
  const guard = journal.inflightGuard?.record;
  const reconstructedGuardBytes = Buffer.from(`${JSON.stringify(guard, null, 2)}\n`);
  const liveGuardPath = join(canonicalRoot, guardFileName);
  if (existsSync(liveGuardPath)) {
    const liveGuardBytes = readPrivateFile(liveGuardPath, 'live in-flight deployment guard');
    if (
      digest(liveGuardBytes) !== journalReference.inflightGuardSha256 ||
      !liveGuardBytes.equals(reconstructedGuardBytes)
    ) {
      throw new Error('Live in-flight guard differs from the committed transition journal');
    }
  }
  if (
    journal.schemaVersion !== 1 ||
    journal.project !== 'GiwaPay' ||
    journal.chainId !== 91342 ||
    journal.operation !== journalReference.operation ||
    journal.sourceCommit !== manifest.sourceCommit.toLowerCase() ||
    journal.evidenceToolingCommit !== journalReference.evidenceToolingCommit.toLowerCase() ||
    journal.signingEvidenceToolingCommit !==
      journalReference.signingEvidenceToolingCommit.toLowerCase() ||
    journal.previousArtifactSha256 !== journalReference.previousArtifactSha256 ||
    journal.previousRecoverySidecarSha256 !== journalReference.previousRecoverySidecarSha256 ||
    journal.nextArtifact?.fileName !== broadcastReference.fileName ||
    journal.nextArtifact?.sha256 !== artifactDigest ||
    journal.nextArtifact?.sourceCommit !== artifact.commit.toLowerCase() ||
    JSON.stringify(journal.resumePolicy) !== JSON.stringify(resumePolicy) ||
    journal.privateCacheEvidence?.persisted !== true ||
    journal.privateCacheEvidence?.fileName !== recoverySidecarReference.fileName ||
    journal.privateCacheEvidence?.sha256 !== recoverySidecarDigest ||
    journal.privateCacheEvidence?.transactionCount !== artifact.transactions.length ||
    journal.privateCacheEvidence?.rpcUrlSha256 !== resumePolicy.rpcUrlSha256 ||
    !sha256Pattern.test(journal.privateCacheEvidence?.sha256 ?? '') ||
    journal.inflightGuard?.fileName !== guardFileName ||
    journal.inflightGuard?.sha256 !== journalReference.inflightGuardSha256 ||
    digest(reconstructedGuardBytes) !== journalReference.inflightGuardSha256 ||
    !isValidGuardRecord(guard) ||
    guard.operation !== journal.operation ||
    guard.sourceCommit !== journal.sourceCommit ||
    guard.signingEvidenceToolingCommit !== journal.signingEvidenceToolingCommit ||
    guard.inputArtifactSha256 !== journal.previousArtifactSha256 ||
    guard.inputRecoverySidecarSha256 !== journal.previousRecoverySidecarSha256 ||
    guard.expectedRpcUrlSha256 !== resumePolicy.rpcUrlSha256 ||
    journal.resumeAuthorizationProvenance !== 'sealed-reviewed-wrapper-transition' ||
    !(
      journal.forgeExitCode === null ||
      (Number.isSafeInteger(journal.forgeExitCode) && journal.forgeExitCode >= 0)
    )
  ) {
    throw new Error('Transition journal does not match the committed manifest');
  }

  if (journal.operation === 'deploy') {
    if (journal.previousArtifactSha256 !== null || journal.previousRecoverySidecarSha256 !== null) {
      throw new Error('Deploy transition cannot have previous recovery artifacts');
    }
  } else {
    if (
      !sha256Pattern.test(journal.previousArtifactSha256 ?? '') ||
      !sha256Pattern.test(journal.previousRecoverySidecarSha256 ?? '')
    ) {
      throw new Error('Resume transition requires previous public and private artifacts');
    }
    const previousBytes = readPrivateFile(
      join(canonicalDirectory, `run-${journal.previousArtifactSha256}.json`),
      'canonical pre-resume broadcast artifact',
    );
    if (digest(previousBytes) !== journal.previousArtifactSha256) {
      throw new Error('Pre-resume artifact SHA-256 differs');
    }
    const previousRecoveryBytes = readPrivateFile(
      join(canonicalPrivateDirectory, `run-${journal.previousRecoverySidecarSha256}.json`),
      'canonical pre-resume recovery sidecar',
    );
    if (digest(previousRecoveryBytes) !== journal.previousRecoverySidecarSha256) {
      throw new Error('Pre-resume recovery sidecar SHA-256 differs');
    }
    validatePrivateCache(previousRecoveryBytes, artifact.transactions.length, currentRpcUrlSha256);
    assertMonotonicResume(parseBroadcast(previousBytes, manifest.sourceCommit), artifact);
  }
  process.stdout.write('true');
}

function parseBroadcast(bytes, sourceCommit) {
  const broadcast = JSON.parse(bytes.toString('utf8'));
  if (
    Number(broadcast.chain) !== 91342 ||
    typeof broadcast.commit !== 'string' ||
    !/^[0-9a-fA-F]{7,40}$/.test(broadcast.commit) ||
    !commitPattern.test(sourceCommit ?? '') ||
    !sourceCommit.toLowerCase().startsWith(broadcast.commit.toLowerCase()) ||
    !Array.isArray(broadcast.transactions) ||
    broadcast.transactions.length === 0
  ) {
    throw new Error('Forge output does not match the reviewed chain and source identity');
  }
  if (broadcast.receipts !== undefined && !Array.isArray(broadcast.receipts)) {
    throw new Error('Forge output receipts must be an array when present');
  }
  if (broadcast.pending !== undefined && !Array.isArray(broadcast.pending)) {
    throw new Error('Forge output pending entries must be an array when present');
  }
  return broadcast;
}

function validatePrivateCache(bytes, expectedTransactionCount, expectedRpcUrlSha256) {
  const value = JSON.parse(bytes.toString('utf8'));
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    JSON.stringify(Object.keys(value).sort()) !== JSON.stringify(['transactions']) ||
    !Array.isArray(value.transactions) ||
    value.transactions.length !== expectedTransactionCount ||
    !value.transactions.every(
      (entry) =>
        entry !== null &&
        typeof entry === 'object' &&
        !Array.isArray(entry) &&
        JSON.stringify(Object.keys(entry).sort()) === JSON.stringify(['rpc']) &&
        typeof entry.rpc === 'string' &&
        digest(Buffer.from(entry.rpc)) === expectedRpcUrlSha256,
    )
  ) {
    throw new Error('Forge sensitive recovery cache differs from the reviewed RPC sequence');
  }
  return {
    sha256: digest(bytes),
    transactionCount: value.transactions.length,
    rpcUrlSha256: expectedRpcUrlSha256,
    persisted: false,
  };
}

function assertMonotonicResume(previous, next) {
  if (JSON.stringify(previous.transactions) !== JSON.stringify(next.transactions)) {
    throw new Error('Resume changed the ordered transaction payloads');
  }
  const previousReceipts = Array.isArray(previous.receipts) ? previous.receipts : [];
  const nextReceiptSet = new Set(
    (Array.isArray(next.receipts) ? next.receipts : []).map(stableRecord),
  );
  if (!previousReceipts.every((receipt) => nextReceiptSet.has(stableRecord(receipt)))) {
    throw new Error('Resume removed or changed previously recorded receipts');
  }
  const previousPendingSet = new Set(
    (Array.isArray(previous.pending) ? previous.pending : []).map(stableRecord),
  );
  const nextPending = Array.isArray(next.pending) ? next.pending : [];
  if (!nextPending.every((pending) => previousPendingSet.has(stableRecord(pending)))) {
    throw new Error('Resume introduced a pending entry outside the reviewed input sequence');
  }
}

function stableRecord(value) {
  return JSON.stringify(value);
}

function parseGuard(bytes) {
  const guard = JSON.parse(bytes.toString('utf8'));
  if (!isValidGuardRecord(guard)) {
    throw new Error('Malformed in-flight deployment guard');
  }
  return guard;
}

function readGuard(path) {
  return parseGuard(readPrivateFile(path, 'in-flight deployment guard'));
}

function isValidGuardRecord(guard) {
  return (
    guard !== null &&
    typeof guard === 'object' &&
    !Array.isArray(guard) &&
    guard.schemaVersion === 1 &&
    guard.project === 'GiwaPay' &&
    guard.chainId === 91342 &&
    tokenPattern.test(guard.attemptToken ?? '') &&
    ['deploy', 'resume'].includes(guard.operation) &&
    commitPattern.test(guard.sourceCommit ?? '') &&
    commitPattern.test(guard.signingEvidenceToolingCommit ?? '') &&
    isNullableDigest(guard.inputArtifactSha256) &&
    isNullableDigest(guard.inputRecoverySidecarSha256) &&
    (guard.operation === 'deploy'
      ? guard.inputArtifactSha256 === null && guard.inputRecoverySidecarSha256 === null
      : sha256Pattern.test(guard.inputArtifactSha256 ?? '') &&
        sha256Pattern.test(guard.inputRecoverySidecarSha256 ?? '')) &&
    sha256Pattern.test(guard.expectedRpcUrlSha256 ?? '') &&
    typeof guard.sealedWorkspace === 'string' &&
    typeof guard.sealedWorkspaceParent === 'string' &&
    typeof guard.sealedWorkspaceName === 'string' &&
    /^giwapay-reviewed-deploy\.[A-Za-z0-9]+$/.test(guard.sealedWorkspaceName) &&
    resolve(guard.sealedWorkspaceParent, guard.sealedWorkspaceName) === guard.sealedWorkspace &&
    typeof guard.fullTreeDirty === 'boolean' &&
    isValidConfiguration(guard.configuration) &&
    typeof guard.startedAt === 'string'
  );
}

function isValidResumePolicy(policy, artifactDigest, transactionCount) {
  return (
    policy?.schemaVersion === 1 &&
    policy.kind === 'content-addressed-foundry-sensitive-sequence' &&
    policy.forgeVersion === forgeVersion &&
    policy.forgeCommit === forgeCommit &&
    sha256Pattern.test(policy.rpcUrlSha256 ?? '') &&
    policy.transactionCount === transactionCount &&
    sha256Pattern.test(policy.recoverySidecarSha256 ?? '') &&
    sha256Pattern.test(artifactDigest)
  );
}

function readConfigurationFromEnvironment() {
  return {
    deployerAddress: requiredAddress('DEPLOYER_ADDRESS'),
    adapterManagerAddress: requiredAddress('ADAPTER_MANAGER_ADDRESS'),
    platformFeeRecipient: requiredAddress('PLATFORM_FEE_RECIPIENT'),
    platformFeeBps: requiredInteger('PLATFORM_FEE_BPS', 0, 10_000),
    productionMode: requiredBoolean('PRODUCTION_MODE'),
    deployTestMocks: requiredBoolean('DEPLOY_TEST_MOCKS'),
  };
}

function assertConfigurationMatchesEnvironment(expected) {
  const actual = readConfigurationFromEnvironment();
  if (
    JSON.stringify(normalizeConfiguration(actual)) !==
    JSON.stringify(normalizeConfiguration(expected))
  ) {
    throw new Error('Deployment configuration changed after the in-flight guard was recorded');
  }
}

function normalizeConfiguration(configuration) {
  return {
    ...configuration,
    deployerAddress: configuration.deployerAddress.toLowerCase(),
    adapterManagerAddress: configuration.adapterManagerAddress.toLowerCase(),
    platformFeeRecipient: configuration.platformFeeRecipient.toLowerCase(),
  };
}

function isValidConfiguration(configuration) {
  return (
    addressPattern.test(configuration?.deployerAddress ?? '') &&
    configuration.deployerAddress !== '0x0000000000000000000000000000000000000000' &&
    addressPattern.test(configuration?.adapterManagerAddress ?? '') &&
    configuration.adapterManagerAddress !== '0x0000000000000000000000000000000000000000' &&
    addressPattern.test(configuration?.platformFeeRecipient ?? '') &&
    configuration.platformFeeRecipient !== '0x0000000000000000000000000000000000000000' &&
    Number.isSafeInteger(configuration?.platformFeeBps) &&
    configuration.platformFeeBps >= 0 &&
    configuration.platformFeeBps <= 10_000 &&
    typeof configuration?.productionMode === 'boolean' &&
    typeof configuration?.deployTestMocks === 'boolean'
  );
}

function assertSafeStorageDirectory(contractsRootValue, directoryValue) {
  const contractsRoot = realpathSync(resolve(contractsRootValue));
  const directory = resolve(directoryValue);
  const relativePath = relative(contractsRoot, directory);
  if (
    !relativePath ||
    relativePath === '..' ||
    relativePath.startsWith(`..${sep}`) ||
    resolve(contractsRoot, relativePath) !== directory
  ) {
    throw new Error('Deployment evidence directory must remain inside the contracts root');
  }
  let cursor = contractsRoot;
  for (const component of relativePath.split(sep)) {
    cursor = join(cursor, component);
    if (!existsSync(cursor)) {
      mkdirSync(cursor, { mode: 0o700 });
    }
    const stats = lstatSync(cursor);
    if (!stats.isDirectory() || stats.isSymbolicLink()) {
      throw new Error('Deployment evidence storage cannot traverse a symlink');
    }
  }
  return realpathSync(directory);
}

function assertPrivateDirectory(pathValue) {
  mkdirSync(pathValue, { recursive: true, mode: 0o700 });
  const realPath = realpathSync(resolve(pathValue));
  const stats = lstatSync(realPath);
  if (!stats.isDirectory() || stats.isSymbolicLink() || (stats.mode & 0o077) !== 0) {
    throw new Error('Sealed deployment directory must remain private');
  }
  return realPath;
}

function assertGuardPath(pathValue) {
  const guardPath = resolve(pathValue);
  if (basename(guardPath) !== guardFileName) {
    throw new Error('Deployment guard path is not canonical');
  }
  const parent = resolve(dirname(guardPath));
  const parentStats = lstatSync(parent);
  if (!parentStats.isDirectory() || parentStats.isSymbolicLink()) {
    throw new Error('Deployment guard parent must be a real directory');
  }
  if (realpathSync(parent) !== parent) {
    throw new Error('Deployment guard parent must use its real path');
  }
  return guardPath;
}

function assertActiveWrapperLock(canonicalRootValue, { expectedToken, expectedOperations }) {
  const canonicalRoot = realpathSync(resolve(canonicalRootValue));
  const lockPath = join(canonicalRoot, 'giwapay-deployment.lock');
  let owner;
  try {
    owner = JSON.parse(readPrivateFile(lockPath, 'active deployment wrapper lock').toString());
  } catch (error) {
    throw new Error('Deployment transition helper requires the active wrapper lock', {
      cause: error,
    });
  }
  if (
    owner?.schemaVersion !== 1 ||
    !tokenPattern.test(owner.token ?? '') ||
    (expectedToken !== undefined && owner.token !== expectedToken) ||
    !expectedOperations.includes(owner.operation) ||
    !Number.isSafeInteger(owner.pid) ||
    !/^[1-9]\d*$/.test(process.env.GIWAPAY_WRAPPER_PID ?? '') ||
    owner.pid !== Number(process.env.GIWAPAY_WRAPPER_PID)
  ) {
    throw new Error('Deployment transition helper is not owned by the active wrapper process');
  }
}

function validateCleanupWorkspace(guard) {
  if (
    resolve(guard.sealedWorkspaceParent, guard.sealedWorkspaceName) !== guard.sealedWorkspace ||
    !/^giwapay-reviewed-deploy\.[A-Za-z0-9]+$/.test(guard.sealedWorkspaceName) ||
    realpathSync(guard.sealedWorkspaceParent) !== guard.sealedWorkspaceParent
  ) {
    throw new Error('In-flight guard workspace is outside the safe cleanup boundary');
  }
  if (!existsSync(guard.sealedWorkspace)) return null;
  const workspace = realpathSync(guard.sealedWorkspace);
  const workspaceStats = lstatSync(workspace);
  if (
    workspace !== guard.sealedWorkspace ||
    dirname(workspace) !== guard.sealedWorkspaceParent ||
    basename(workspace) !== guard.sealedWorkspaceName ||
    !workspaceStats.isDirectory() ||
    workspaceStats.isSymbolicLink() ||
    (workspaceStats.mode & 0o077) !== 0
  ) {
    throw new Error('In-flight guard workspace is outside the safe cleanup boundary');
  }
  return workspace;
}

function isPathInside(rootValue, pathValue) {
  const root = realpathSync(resolve(rootValue));
  const path = realpathSync(resolve(pathValue));
  const relativePath = relative(root, path);
  return relativePath !== '' && relativePath !== '..' && !relativePath.startsWith(`..${sep}`);
}

function storeImmutable(path, bytes, mode) {
  let descriptor;
  try {
    descriptor = openSync(path, 'wx', mode);
    writeFileSync(descriptor, bytes);
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
    fsyncDirectory(dirname(path));
  } catch (error) {
    if (descriptor !== undefined) closeSync(descriptor);
    if (error?.code !== 'EEXIST') throw error;
    const existing = readPrivateFile(path, 'existing content-addressed evidence');
    if (!existing.equals(bytes)) {
      throw new Error('Content-addressed evidence path already contains different bytes');
    }
  }
}

function readPrivateFile(path, label) {
  const stats = lstatSync(path);
  if (!stats.isFile() || stats.isSymbolicLink() || (stats.mode & 0o077) !== 0) {
    throw new Error(`${label} must be a private regular file`);
  }
  return readFileSync(path);
}

function writeJsonAtomically(path, value, mode) {
  const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
  const temporaryPath = join(
    dirname(path),
    `.${basename(path)}.${process.pid}.${randomUUID()}.tmp`,
  );
  let descriptor;
  try {
    descriptor = openSync(temporaryPath, 'wx', mode);
    writeFileSync(descriptor, bytes);
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
    renameSync(temporaryPath, path);
    fsyncDirectory(dirname(path));
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
    rmSync(temporaryPath, { force: true });
  }
}

function fsyncDirectory(path) {
  const directoryDescriptor = openSync(path, 'r');
  try {
    fsyncSync(directoryDescriptor);
  } finally {
    closeSync(directoryDescriptor);
  }
}

function digest(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function isOptionalDigest(value) {
  return value === 'none' || sha256Pattern.test(value ?? '');
}

function isNullableDigest(value) {
  return value === null || sha256Pattern.test(value ?? '');
}

function requiredAddress(name) {
  const value = process.env[name];
  if (!addressPattern.test(value ?? '') || value === '0x0000000000000000000000000000000000000000') {
    throw new Error(`${name} must be a nonzero address`);
  }
  return value;
}

function requiredInteger(name, minimum, maximum) {
  const value = process.env[name];
  if (!/^\d+$/.test(value ?? '')) {
    throw new Error(`${name} must be an integer`);
  }
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < minimum || number > maximum) {
    throw new Error(`${name} is outside the allowed range`);
  }
  return number;
}

function requiredBoolean(name) {
  const value = process.env[name];
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new Error(`${name} must be true or false`);
}
