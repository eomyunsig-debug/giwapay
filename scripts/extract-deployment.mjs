import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import process from 'node:process';

const [broadcastPath, outputPath, chainIdValue, mode = 'unknown'] = process.argv.slice(2);

if (!broadcastPath || !outputPath || !chainIdValue) {
  throw new Error(
    'Usage: node scripts/extract-deployment.mjs <broadcast.json> <output.json> <chainId> [mode]',
  );
}

const chainId = Number(chainIdValue);
if (!Number.isSafeInteger(chainId) || chainId <= 0) {
  throw new Error('chainId must be a positive safe integer');
}

const broadcast = JSON.parse(await readFile(resolve(broadcastPath), 'utf8'));
const creates = Array.isArray(broadcast.transactions)
  ? broadcast.transactions.filter(
      (entry) =>
        entry?.transactionType === 'CREATE' &&
        typeof entry.contractName === 'string' &&
        /^0x[0-9a-fA-F]{40}$/.test(entry.contractAddress),
    )
  : [];

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

const contracts = {};
for (const entry of creates) {
  const key = contractNameToKey[entry.contractName];
  if (key) contracts[key] = entry.contractAddress;
}

for (const required of ['merchantRegistry', 'adapterRegistry', 'paymentRouter']) {
  if (!contracts[required]) {
    throw new Error(`Broadcast does not contain required contract: ${required}`);
  }
}

const manifest = {
  schemaVersion: 1,
  project: 'GiwaPay',
  chainId,
  mode,
  generatedAt: new Date().toISOString(),
  sourceBroadcast: resolve(broadcastPath),
  contracts,
};

const destination = resolve(outputPath);
await mkdir(dirname(destination), { recursive: true });
await writeFile(destination, `${JSON.stringify(manifest, null, 2)}\n`, {
  mode: 0o600,
});
process.stdout.write(`Deployment manifest written to ${destination}\n`);
