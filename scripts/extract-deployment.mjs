import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import process from 'node:process';
import { clearTimeout, setTimeout } from 'node:timers';
import { URL } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const addressPattern = /^0x[0-9a-fA-F]{40}$/;
const hashPattern = /^0x[0-9a-fA-F]{64}$/;
const sourceCommitPattern = /^[0-9a-fA-F]{40}$/;

const [broadcastPath, outputPath, chainIdValue, mode = 'unknown', ...options] =
  process.argv.slice(2);

if (!broadcastPath || !outputPath || !chainIdValue) {
  throw new Error(
    'Usage: node scripts/extract-deployment.mjs <broadcast.json> <output.json> <chainId> [mode] [--public]',
  );
}

for (const option of options) {
  if (option !== '--public') {
    throw new Error(`Unknown option: ${option}`);
  }
}
const publicManifest = options.includes('--public');

const chainId = Number(chainIdValue);
if (!Number.isSafeInteger(chainId) || chainId <= 0) {
  throw new Error('chainId must be a positive safe integer');
}

const resolvedBroadcastPath = resolve(broadcastPath);
const broadcastBytes = await readFile(resolvedBroadcastPath);
const broadcast = JSON.parse(broadcastBytes.toString('utf8'));

if (broadcast.chain !== undefined && parseChainId(broadcast.chain) !== chainId) {
  throw new Error(
    `Broadcast chain ${String(broadcast.chain)} does not match requested chain ${chainId}`,
  );
}

const contractNameToKey = {
  MerchantRegistry: 'merchantRegistry',
  AdapterRegistry: 'adapterRegistry',
  PaymentRouter: 'paymentRouter',
  MockKRW: 'mockKRW',
  MockUSDC: 'mockUSDC',
  MockALT: 'mockALT',
  MockTokenFaucet: 'mockTokenFaucet',
  MockFixedRateExactOutputAdapter: 'mockExactOutputAdapter',
};

const recognizedCreates = Array.isArray(broadcast.transactions)
  ? broadcast.transactions.filter(
      (entry) =>
        entry?.transactionType === 'CREATE' &&
        typeof entry.contractName === 'string' &&
        contractNameToKey[entry.contractName],
    )
  : [];

if (!publicManifest) {
  const contracts = {};
  for (const entry of recognizedCreates) {
    if (addressPattern.test(entry.contractAddress ?? '')) {
      contracts[contractNameToKey[entry.contractName]] = entry.contractAddress;
    }
  }

  for (const required of ['merchantRegistry', 'adapterRegistry', 'paymentRouter']) {
    if (!contracts[required]) {
      throw new Error(`Broadcast does not contain required contract: ${required}`);
    }
  }

  await writeJsonAtomically(
    outputPath,
    {
      schemaVersion: 1,
      project: 'GiwaPay',
      chainId,
      mode,
      generatedAt: new Date().toISOString(),
      sourceBroadcast: resolvedBroadcastPath,
      contracts,
    },
    0o600,
  );
  process.stdout.write(`Deployment manifest written to ${resolve(outputPath)}\n`);
  process.exit(0);
}

if (chainId !== 91_342 || mode !== 'giwa-sepolia') {
  throw new Error('Public deployment evidence is supported only for GIWA Sepolia chain 91342');
}

const sourceCommit = process.env.DEPLOYMENT_SOURCE_COMMIT;
if (!sourceCommitPattern.test(sourceCommit ?? '')) {
  throw new Error('DEPLOYMENT_SOURCE_COMMIT must be a full 40-character Git commit SHA');
}
const evidenceToolingCommit = process.env.DEPLOYMENT_EVIDENCE_TOOLING_COMMIT ?? sourceCommit;
if (!sourceCommitPattern.test(evidenceToolingCommit)) {
  throw new Error('DEPLOYMENT_EVIDENCE_TOOLING_COMMIT must be a full 40-character Git commit SHA');
}
const broadcastSourceCommit =
  typeof broadcast.commit === 'string' && /^[0-9a-fA-F]{7,40}$/.test(broadcast.commit)
    ? broadcast.commit.toLowerCase()
    : null;

const previousManifest = await readExistingPublicManifest(outputPath);
const receipts = Array.isArray(broadcast.receipts) ? broadcast.receipts : [];
const rpcUrl = nonempty(process.env.DEPLOYMENT_RPC_URL);
const verifierUrl = nonempty(process.env.DEPLOYMENT_VERIFIER_URL);
const explorerBaseUrl = sanitizePublicBaseUrl(
  nonempty(process.env.DEPLOYMENT_EXPLORER_BASE_URL) ?? 'https://sepolia-explorer.giwa.io',
);
const warnings = [];
const sourceCommitMismatch =
  broadcastSourceCommit !== null &&
  !sourceCommit.toLowerCase().startsWith(broadcastSourceCommit.toLowerCase());
if (sourceCommitMismatch) {
  warnings.push('Foundry broadcast commit does not match the reviewed source commit');
}
const deployments = [];

for (const entry of recognizedCreates) {
  if (!addressPattern.test(entry.contractAddress ?? '')) {
    throw new Error(`Malformed ${entry.contractName} deployment address`);
  }

  const address = entry.contractAddress;
  const matchingReceipts = receipts.filter(
    (receipt) =>
      addressPattern.test(receipt?.contractAddress ?? '') &&
      sameAddress(receipt.contractAddress, address),
  );

  if (matchingReceipts.length > 1) {
    warnings.push(`${entry.contractName} has multiple receipts for the same contract address`);
  }

  const evidence = {
    key: contractNameToKey[entry.contractName],
    contractName: entry.contractName,
    address,
    constructorArguments: sanitizeArguments(entry.arguments),
    broadcastReportedTransactionHash: validHashOrNull(entry.hash),
    transactionHash: null,
    blockHash: null,
    blockNumber: null,
    receiptStatus: matchingReceipts.length === 0 ? 'unavailable' : 'ambiguous',
    runtimeCodeHash: null,
    runtimeCodeStatus: rpcUrl ? 'query-pending' : 'not-queried',
    explorerUrl: `${explorerBaseUrl}/address/${address}`,
    verificationUrl: `${explorerBaseUrl}/address/${address}?tab=contract`,
  };

  if (matchingReceipts.length === 1) {
    applyReceiptEvidence(evidence, matchingReceipts[0], warnings);
  }

  deployments.push(evidence);
}

if (rpcUrl) {
  const candidateTransactionHashes = [
    ...new Set(
      (Array.isArray(broadcast.transactions) ? broadcast.transactions : [])
        .map((entry) => validHashOrNull(entry?.hash))
        .filter(Boolean),
    ),
  ];
  const queriedReceipts = (
    await Promise.all(
      candidateTransactionHashes.map(async (transactionHash) => {
        try {
          return await rpcCall(rpcUrl, 'eth_getTransactionReceipt', [transactionHash]);
        } catch {
          return null;
        }
      }),
    )
  ).filter(Boolean);

  for (const evidence of deployments) {
    if (evidence.receiptStatus !== 'unavailable') continue;
    const matchingQueriedReceipts = queriedReceipts.filter(
      (receipt) =>
        addressPattern.test(receipt?.contractAddress ?? '') &&
        sameAddress(receipt.contractAddress, evidence.address),
    );
    if (matchingQueriedReceipts.length === 1) {
      applyReceiptEvidence(evidence, matchingQueriedReceipts[0], warnings);
    } else if (matchingQueriedReceipts.length > 1) {
      evidence.receiptStatus = 'ambiguous';
      warnings.push(`${evidence.contractName} has multiple queried deployment receipts`);
    }
  }

  await Promise.all(
    deployments.map(async (evidence) => {
      try {
        const code = await rpcCall(rpcUrl, 'eth_getCode', [evidence.address, 'latest']);
        if (!/^0x[0-9a-fA-F]*$/.test(code ?? '')) {
          throw new Error('invalid runtime code response');
        }
        if (code === '0x') {
          evidence.runtimeCodeStatus = 'no-code';
          return;
        }

        try {
          const proof = await rpcCall(rpcUrl, 'eth_getProof', [evidence.address, [], 'latest']);
          if (hashPattern.test(proof?.codeHash ?? '')) {
            evidence.runtimeCodeHash = proof.codeHash;
            evidence.runtimeCodeStatus = 'confirmed';
            return;
          }
        } catch {
          // Some EVM RPC providers do not expose eth_getProof.
        }

        const { stdout } = await execFileAsync('cast', ['keccak', code], {
          timeout: 10_000,
          maxBuffer: 1024 * 1024,
        });
        const codeHash = stdout.trim();
        if (!hashPattern.test(codeHash)) throw new Error('invalid cast code hash');
        evidence.runtimeCodeHash = codeHash;
        evidence.runtimeCodeStatus = 'confirmed';
      } catch {
        evidence.runtimeCodeStatus = 'unavailable';
        warnings.push(`${evidence.contractName} runtime code hash could not be confirmed`);
      }
    }),
  );
}

const groupedByKey = Map.groupBy(deployments, (entry) => entry.key);
const groupedByAddress = Map.groupBy(deployments, (entry) => entry.address.toLowerCase());
for (const [key, entries] of groupedByKey) {
  if (entries.length > 1) warnings.push(`Multiple ${key} deployments are present`);
}
for (const entries of groupedByAddress.values()) {
  if (entries.length > 1) warnings.push(`One address is attributed to multiple deployments`);
}

const contracts = {};
const contractEvidence = {};
for (const [key, entries] of groupedByKey) {
  if (entries.length === 1) {
    contracts[key] = entries[0].address;
    contractEvidence[key] = withoutInternalKey(entries[0]);
  }
}

const { configuration, conflicts: configurationConflicts } = resolveConfiguration(
  contractEvidence,
  previousManifest?.configuration,
);
for (const conflict of configurationConflicts) {
  warnings.push(`Recorded deployment configuration conflicts with ${conflict}`);
}
if (configuration.productionMode === true && configuration.deployTestMocks === true) {
  warnings.push('Production mode conflicts with requested test mocks');
}
if (configuration.deployTestMocks === null) {
  warnings.push('DEPLOY_TEST_MOCKS could not be established from reviewed evidence');
}

const onChainConfiguration =
  rpcUrl && parseOptionalBoolean(process.env.DEPLOYMENT_QUERY_ONCHAIN_CONFIGURATION) === true
    ? await queryOnChainConfiguration(rpcUrl, contracts, configuration)
    : { status: 'not-queried' };

const verificationRequested =
  parseOptionalBoolean(process.env.DEPLOYMENT_VERIFICATION_REQUESTED) ??
  previousManifest?.verification?.requested ??
  false;
const verificationContracts = {};
for (const evidence of deployments) {
  let status = 'not-queried';
  if (verifierUrl) {
    status = await queryVerificationStatus(verifierUrl, evidence.address);
  }
  verificationContracts[evidence.key] = {
    address: evidence.address,
    status,
    url: evidence.verificationUrl,
  };
}

const verificationStatuses = Object.values(verificationContracts).map((entry) => entry.status);
const verificationStatus = overallVerificationStatus(
  verificationRequested,
  verificationStatuses,
  Boolean(verifierUrl),
);

const requiredKeys = configuration.deployTestMocks
  ? [
      'merchantRegistry',
      'adapterRegistry',
      'paymentRouter',
      'mockKRW',
      'mockUSDC',
      'mockALT',
      'mockTokenFaucet',
      'mockExactOutputAdapter',
    ]
  : ['merchantRegistry', 'adapterRegistry', 'paymentRouter'];
const uniqueRequired = requiredKeys.every((key) => groupedByKey.get(key)?.length === 1);
const requiredReceiptsComplete = requiredKeys.every((key) => {
  const evidence = groupedByKey.get(key)?.[0];
  return (
    evidence?.receiptStatus === 'success' &&
    hashPattern.test(evidence.transactionHash ?? '') &&
    evidence.blockNumber !== null
  );
});
const broadcastTransactions = Array.isArray(broadcast.transactions) ? broadcast.transactions : [];
const broadcastPendingKnown = Array.isArray(broadcast.pending);
const broadcastPending = Array.isArray(broadcast.pending) ? broadcast.pending : [];
const everyBroadcastTransactionReceiptSucceeded =
  broadcastTransactions.length > 0 &&
  receipts.length === broadcastTransactions.length &&
  broadcastTransactions.every((transaction) => {
    const matchingReceipts = receipts.filter((receipt) =>
      receiptMatchesBroadcastTransaction(transaction, receipt),
    );
    return (
      matchingReceipts.length === 1 &&
      receiptStatus(matchingReceipts[0]?.status) === 'success' &&
      hashPattern.test(matchingReceipts[0]?.transactionHash ?? '') &&
      parseBlockNumber(matchingReceipts[0]?.blockNumber) !== null
    );
  }) &&
  receipts.every(
    (receipt) =>
      broadcastTransactions.filter((transaction) =>
        receiptMatchesBroadcastTransaction(transaction, receipt),
      ).length === 1,
  );
const hasEvidenceConflict =
  sourceCommitMismatch ||
  configurationConflicts.length > 0 ||
  [...groupedByKey.values()].some((entries) => entries.length > 1) ||
  [...groupedByAddress.values()].some((entries) => entries.length > 1) ||
  receipts.some((receipt) => receiptStatus(receipt?.status) === 'failed') ||
  deployments.some(
    (entry) =>
      entry.receiptStatus === 'failed' ||
      entry.receiptStatus === 'ambiguous' ||
      (entry.receiptStatus === 'success' && entry.runtimeCodeStatus === 'no-code'),
  );

let deploymentStatus = 'no-broadcast-evidence';
if (hasEvidenceConflict) {
  deploymentStatus = 'evidence-conflict';
} else if (uniqueRequired && requiredReceiptsComplete) {
  deploymentStatus =
    everyBroadcastTransactionReceiptSucceeded &&
    broadcastPendingKnown &&
    broadcastPending.length === 0 &&
    configuration.deployTestMocks !== null
      ? 'broadcast-complete'
      : 'broadcast-partial';
} else if (deployments.length > 0) {
  deploymentStatus = 'broadcast-partial';
}

const successfulBlockNumbers = deployments
  .filter((entry) => entry.receiptStatus === 'success' && entry.blockNumber !== null)
  .map((entry) => BigInt(entry.blockNumber));
const earliestIndexedBlock =
  successfulBlockNumbers.length > 0
    ? successfulBlockNumbers.reduce((minimum, current) => (current < minimum ? current : minimum))
    : null;
const manifestVerificationStatus =
  deploymentStatus === 'broadcast-complete'
    ? verificationStatus
    : verificationStatus === 'verified' || verificationStatus === 'partially-verified'
      ? 'deployment-incomplete'
      : verificationStatus;

const manifest = {
  schemaVersion: 2,
  project: 'GiwaPay',
  chainId,
  mode,
  generatedAt: new Date().toISOString(),
  deploymentStatus,
  sourceCommit: sourceCommit.toLowerCase(),
  evidenceToolingCommit: evidenceToolingCommit.toLowerCase(),
  deploymentScopeDirty:
    parseOptionalBoolean(process.env.DEPLOYMENT_SCOPE_DIRTY) ??
    previousManifest?.deploymentScopeDirty ??
    null,
  fullTreeDirty:
    parseOptionalBoolean(process.env.DEPLOYMENT_FULL_TREE_DIRTY) ??
    previousManifest?.fullTreeDirty ??
    null,
  broadcastArtifact: {
    fileName: basename(resolvedBroadcastPath),
    sha256: createHash('sha256').update(broadcastBytes).digest('hex'),
    sourceCommit: broadcastSourceCommit,
    transactionCount: Array.isArray(broadcast.transactions) ? broadcast.transactions.length : 0,
    receiptCount: receipts.length,
  },
  configuration,
  configurationConflicts,
  mockReadiness:
    configuration.deployTestMocks === true
      ? {
          status: 'not-proven',
          reason:
            'Mock adapter routes, caps, faucet roles/settings, token minter roles, and liquidity require separate on-chain proof.',
        }
      : configuration.deployTestMocks === false
        ? { status: 'not-applicable' }
        : {
            status: 'unknown',
            reason: 'Mock deployment mode is not established by reviewed evidence.',
          },
  onChainConfiguration,
  contracts,
  contractEvidence,
  deployments: deployments.map(withoutInternalKey),
  earliestIndexedBlock: earliestIndexedBlock === null ? null : earliestIndexedBlock.toString(10),
  verification: {
    requested: verificationRequested,
    status: manifestVerificationStatus,
    checkedAt: verifierUrl ? new Date().toISOString() : null,
    explorerBaseUrl,
    contracts: verificationContracts,
  },
  notes: [...new Set(warnings)],
};

await writeJsonAtomically(outputPath, manifest, 0o644);
process.stdout.write(`Public deployment evidence written to ${resolve(outputPath)}\n`);

function nonempty(value) {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function parseChainId(value) {
  if (typeof value === 'number') return value;
  if (typeof value !== 'string' || value.length === 0) return Number.NaN;
  return Number(value);
}

function sameAddress(left, right) {
  return left.toLowerCase() === right.toLowerCase();
}

function validHashOrNull(value) {
  return hashPattern.test(value ?? '') ? value : null;
}

function parseOptionalBoolean(value) {
  if (value === undefined || value === '') return null;
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new Error(`Expected true or false, received ${value}`);
}

function parseOptionalInteger(value, label, minimum, maximum) {
  if (value === undefined || value === '') return null;
  if (!/^\d+$/.test(value)) throw new Error(`${label} must be an integer`);
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < minimum || number > maximum) {
    throw new Error(`${label} is outside its supported range`);
  }
  return number;
}

function parseBlockNumber(value) {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) {
    return String(value);
  }
  if (typeof value !== 'string') return null;
  try {
    if (!/^(0x[0-9a-fA-F]+|\d+)$/.test(value)) return null;
    return BigInt(value).toString(10);
  } catch {
    return null;
  }
}

function receiptStatus(value) {
  if (value === 1 || value === '1' || value === '0x1' || value === true) return 'success';
  if (value === 0 || value === '0' || value === '0x0' || value === false) return 'failed';
  return 'unknown';
}

function receiptMatchesBroadcastTransaction(transaction, receipt) {
  if (
    transaction?.transactionType === 'CREATE' &&
    addressPattern.test(transaction.contractAddress ?? '')
  ) {
    return (
      addressPattern.test(receipt?.contractAddress ?? '') &&
      sameAddress(transaction.contractAddress, receipt.contractAddress)
    );
  }

  const transactionHash = validHashOrNull(transaction?.hash);
  const receiptHash = validHashOrNull(receipt?.transactionHash);
  return (
    transactionHash !== null &&
    receiptHash !== null &&
    transactionHash.toLowerCase() === receiptHash.toLowerCase()
  );
}

function applyReceiptEvidence(evidence, receipt, warningTarget) {
  evidence.transactionHash = validHashOrNull(receipt.transactionHash);
  evidence.blockHash = validHashOrNull(receipt.blockHash);
  evidence.blockNumber = parseBlockNumber(receipt.blockNumber);
  evidence.receiptStatus = receiptStatus(receipt.status);

  if (!evidence.transactionHash) {
    warningTarget.push(`${evidence.contractName} receipt has no valid transaction hash`);
  }
  if (evidence.blockNumber === null) {
    warningTarget.push(`${evidence.contractName} receipt has no valid block number`);
  }
  if (evidence.receiptStatus !== 'success') {
    warningTarget.push(`${evidence.contractName} receipt is not successful`);
  }
}

function sanitizeArguments(value) {
  if (!Array.isArray(value)) return null;
  return value.slice(0, 64).map((entry) => {
    if (entry === null || typeof entry === 'boolean') return entry;
    if (typeof entry === 'number' && Number.isFinite(entry)) return entry;
    if (typeof entry === 'string') return entry.slice(0, 10_000);
    return String(entry).slice(0, 10_000);
  });
}

function withoutInternalKey(entry) {
  const evidence = { ...entry };
  delete evidence.key;
  return evidence;
}

function sanitizePublicBaseUrl(value) {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('DEPLOYMENT_EXPLORER_BASE_URL must use HTTP or HTTPS');
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error(
      'Public explorer URL must not contain credentials, query parameters, or a fragment',
    );
  }
  return url.toString().replace(/\/$/, '');
}

function resolveConfiguration(evidence, previous = {}) {
  const adapterArguments = evidence.adapterRegistry?.constructorArguments ?? [];
  const routerArguments = evidence.paymentRouter?.constructorArguments ?? [];
  const conflicts = [];
  const select = (field, candidates, equal = (left, right) => left === right) => {
    const recorded =
      previous[field] ?? candidates.find((entry) => entry.value !== null)?.value ?? null;
    for (const candidate of candidates) {
      if (recorded !== null && candidate.value !== null && !equal(recorded, candidate.value)) {
        conflicts.push(`${candidate.source} ${field}`);
      }
    }
    return recorded;
  };
  const addressEqual = (left, right) => sameAddress(left, right);

  const configuration = {
    deployerAddress: select(
      'deployerAddress',
      [
        {
          source: 'operator input',
          value: validAddressOrNull(process.env.DEPLOYER_ADDRESS),
        },
        {
          source: 'router constructor',
          value: validAddressOrNull(routerArguments[0]),
        },
        {
          source: 'registry constructor',
          value: validAddressOrNull(adapterArguments[0]),
        },
      ],
      addressEqual,
    ),
    adapterManagerAddress: select(
      'adapterManagerAddress',
      [
        {
          source: 'operator input',
          value: validAddressOrNull(process.env.ADAPTER_MANAGER_ADDRESS),
        },
        {
          source: 'registry constructor',
          value: validAddressOrNull(adapterArguments[1]),
        },
      ],
      addressEqual,
    ),
    platformFeeRecipient: select(
      'platformFeeRecipient',
      [
        {
          source: 'operator input',
          value: validAddressOrNull(process.env.PLATFORM_FEE_RECIPIENT),
        },
        {
          source: 'router constructor',
          value: validAddressOrNull(routerArguments[3]),
        },
      ],
      addressEqual,
    ),
    platformFeeBps: select('platformFeeBps', [
      {
        source: 'operator input',
        value: parseOptionalInteger(process.env.PLATFORM_FEE_BPS, 'PLATFORM_FEE_BPS', 0, 10_000),
      },
      {
        source: 'router constructor',
        value: parseNumberish(routerArguments[4], 0, 10_000),
      },
    ]),
    productionMode: select('productionMode', [
      {
        source: 'operator input',
        value: parseOptionalBoolean(process.env.PRODUCTION_MODE),
      },
      {
        source: 'registry constructor',
        value: parseBooleanish(adapterArguments[2]),
      },
    ]),
    deployTestMocks: select('deployTestMocks', [
      {
        source: 'operator input',
        value: parseOptionalBoolean(process.env.DEPLOY_TEST_MOCKS),
      },
      {
        source: 'broadcast contracts',
        value: Object.hasOwn(evidence, 'mockKRW') ? true : null,
      },
    ]),
    deployerBalanceWeiAtPreflight:
      previous.deployerBalanceWeiAtPreflight ??
      parseUnsignedIntegerString(process.env.DEPLOYER_BALANCE_WEI) ??
      null,
  };

  return { configuration, conflicts: [...new Set(conflicts)] };
}

function validAddressOrNull(value) {
  return addressPattern.test(value ?? '') ? value : null;
}

function parseNumberish(value, minimum, maximum) {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const string = String(value);
  if (!/^\d+$/.test(string)) return null;
  const parsed = Number(string);
  return Number.isSafeInteger(parsed) && parsed >= minimum && parsed <= maximum ? parsed : null;
}

function parseBooleanish(value) {
  if (value === true || value === 'true') return true;
  if (value === false || value === 'false') return false;
  return null;
}

function parseUnsignedIntegerString(value) {
  return /^\d+$/.test(value ?? '') ? value : null;
}

async function rpcCall(url, method, params) {
  const controller = new globalThis.AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await globalThis.fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error('RPC HTTP request failed');
    const payload = await response.json();
    if (payload.error) throw new Error('RPC returned an error');
    return payload.result;
  } finally {
    clearTimeout(timeout);
  }
}

async function castCall(rpcUrlValue, address, signature, args = []) {
  const { stdout } = await execFileAsync('cast', ['call', address, signature, ...args], {
    env: { ...process.env, ETH_RPC_URL: rpcUrlValue },
    timeout: 10_000,
    maxBuffer: 1024 * 1024,
  });
  return stdout.trim();
}

async function queryOnChainConfiguration(rpcUrlValue, addresses, expected) {
  if (!addresses.paymentRouter || !addresses.adapterRegistry) {
    return { status: 'unavailable', reason: 'required-contract-address-missing' };
  }

  try {
    const [
      routerOwner,
      feeRecipient,
      feeBps,
      merchantRegistry,
      adapterRegistry,
      registryOwner,
      productionMode,
    ] = await Promise.all([
      castCall(rpcUrlValue, addresses.paymentRouter, 'owner()(address)'),
      castCall(rpcUrlValue, addresses.paymentRouter, 'platformFeeRecipient()(address)'),
      castCall(rpcUrlValue, addresses.paymentRouter, 'platformFeeBps()(uint16)'),
      castCall(rpcUrlValue, addresses.paymentRouter, 'merchantRegistry()(address)'),
      castCall(rpcUrlValue, addresses.paymentRouter, 'adapterRegistry()(address)'),
      castCall(rpcUrlValue, addresses.adapterRegistry, 'owner()(address)'),
      castCall(rpcUrlValue, addresses.adapterRegistry, 'productionMode()(bool)'),
    ]);

    const managerEnabled = expected.adapterManagerAddress
      ? await castCall(rpcUrlValue, addresses.adapterRegistry, 'adapterManagers(address)(bool)', [
          expected.adapterManagerAddress,
        ])
      : null;

    return {
      status: 'confirmed',
      paymentRouter: {
        owner: validAddressOrNull(routerOwner),
        platformFeeRecipient: validAddressOrNull(feeRecipient),
        platformFeeBps: parseNumberish(feeBps, 0, 10_000),
        merchantRegistry: validAddressOrNull(merchantRegistry),
        adapterRegistry: validAddressOrNull(adapterRegistry),
      },
      adapterRegistry: {
        owner: validAddressOrNull(registryOwner),
        productionMode: parseBooleanish(productionMode),
        configuredManagerEnabled: parseBooleanish(managerEnabled),
      },
      matchesExpected: {
        deployerOwnsRouter:
          expected.deployerAddress && validAddressOrNull(routerOwner)
            ? sameAddress(expected.deployerAddress, routerOwner)
            : null,
        deployerOwnsAdapterRegistry:
          expected.deployerAddress && validAddressOrNull(registryOwner)
            ? sameAddress(expected.deployerAddress, registryOwner)
            : null,
        feeRecipient:
          expected.platformFeeRecipient && validAddressOrNull(feeRecipient)
            ? sameAddress(expected.platformFeeRecipient, feeRecipient)
            : null,
        feeBps:
          expected.platformFeeBps !== null
            ? expected.platformFeeBps === parseNumberish(feeBps, 0, 10_000)
            : null,
        productionMode:
          expected.productionMode !== null
            ? expected.productionMode === parseBooleanish(productionMode)
            : null,
        registryReferences:
          validAddressOrNull(merchantRegistry) && validAddressOrNull(adapterRegistry)
            ? sameAddress(merchantRegistry, addresses.merchantRegistry) &&
              sameAddress(adapterRegistry, addresses.adapterRegistry)
            : null,
      },
    };
  } catch {
    return { status: 'unavailable', reason: 'on-chain-query-failed' };
  }
}

async function queryVerificationStatus(apiUrl, address) {
  try {
    const url = new URL(apiUrl);
    url.searchParams.set('module', 'contract');
    url.searchParams.set('action', 'getsourcecode');
    url.searchParams.set('address', address);
    const controller = new globalThis.AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    let response;
    try {
      response = await globalThis.fetch(url, { signal: controller.signal });
    } finally {
      clearTimeout(timeout);
    }
    if (!response.ok) return 'query-failed';
    const payload = await response.json();
    const record = Array.isArray(payload.result) ? payload.result[0] : null;
    if (typeof record?.SourceCode === 'string' && record.SourceCode.trim().length > 0) {
      return 'verified';
    }
    const unverifiedText = `${record?.ABI ?? ''} ${payload.message ?? ''} ${
      typeof payload.result === 'string' ? payload.result : ''
    }`;
    if (/not verified|source code not verified/i.test(unverifiedText)) return 'unverified';
    return 'unconfirmed';
  } catch {
    return 'query-failed';
  }
}

function overallVerificationStatus(requested, statuses, queried) {
  if (statuses.length > 0 && statuses.every((status) => status === 'verified')) {
    return 'verified';
  }
  if (statuses.some((status) => status === 'verified')) return 'partially-verified';
  if (!requested && !queried) return 'not-requested';
  if (statuses.some((status) => status === 'unverified')) return 'unverified';
  return requested ? 'requested-unconfirmed' : 'not-requested';
}

async function readExistingPublicManifest(path) {
  try {
    const parsed = JSON.parse(await readFile(resolve(path), 'utf8'));
    return parsed?.schemaVersion === 2 ? parsed : null;
  } catch {
    return null;
  }
}

async function writeJsonAtomically(path, value, modeBits) {
  const destination = resolve(path);
  await mkdir(dirname(destination), { recursive: true });
  const temporary = `${destination}.tmp-${process.pid}-${Date.now()}`;
  try {
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, {
      mode: modeBits,
    });
    await rename(temporary, destination);
  } finally {
    await rm(temporary, { force: true });
  }
}
