import { appendFile, chmod, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import process from 'node:process';

const [environmentPath, manifestPath] = process.argv.slice(2);

if (!environmentPath || !manifestPath) {
  throw new Error('Usage: node scripts/render-demo-env.mjs <environment-file> <manifest>');
}

const manifest = JSON.parse(await readFile(resolve(manifestPath), 'utf8'));
if (manifest.chainId !== 91342 || manifest.mode !== 'local-anvil') {
  throw new Error('Expected a local Anvil manifest with chain ID 91342');
}

const addressPattern = /^0x[0-9a-fA-F]{40}$/;
const required = [
  'merchantRegistry',
  'adapterRegistry',
  'paymentRouter',
  'mockKRW',
  'mockUSDC',
  'mockALT',
  'mockTokenFaucet',
  'mockExactOutputAdapter',
];
for (const key of required) {
  if (!addressPattern.test(manifest.contracts?.[key] ?? '')) {
    throw new Error(`Deployment manifest is missing ${key}`);
  }
}

const contracts = manifest.contracts;
const supportedTokens = [
  {
    token: contracts.mockKRW,
    tokenSymbol: 'MockKRW',
    tokenName: 'GiwaPay Testnet Mock KRW',
    tokenDecimals: 6,
    settlementToken: contracts.mockKRW,
    adapterIdentifier: 'direct',
    adapterData: '0x',
    defaultSlippageBps: 0,
    testOnly: true,
  },
  {
    token: contracts.mockUSDC,
    tokenSymbol: 'MockUSDC',
    tokenName: 'GiwaPay Testnet Mock USDC',
    tokenDecimals: 6,
    settlementToken: contracts.mockKRW,
    adapter: contracts.mockExactOutputAdapter,
    adapterIdentifier: 'mock-fixed-rate-v1',
    adapterData: '0x',
    maxInputCap: '1000000000000000',
    defaultSlippageBps: 100,
    testOnly: true,
  },
  {
    token: contracts.mockALT,
    tokenSymbol: 'MockALT',
    tokenName: 'GiwaPay Testnet Mock ALT',
    tokenDecimals: 18,
    settlementToken: contracts.mockKRW,
    adapter: contracts.mockExactOutputAdapter,
    adapterIdentifier: 'mock-fixed-rate-v1',
    adapterData: '0x',
    maxInputCap: '1000000000000000000000000000',
    defaultSlippageBps: 100,
    testOnly: true,
  },
];

const lines = [
  `PAYMENT_ROUTER_ADDRESS=${contracts.paymentRouter}`,
  `MERCHANT_REGISTRY_ADDRESS=${contracts.merchantRegistry}`,
  `ADAPTER_REGISTRY_ADDRESS=${contracts.adapterRegistry}`,
  `MOCK_KRW_ADDRESS=${contracts.mockKRW}`,
  `MOCK_USDC_ADDRESS=${contracts.mockUSDC}`,
  `MOCK_ALT_ADDRESS=${contracts.mockALT}`,
  `MOCK_TOKEN_FAUCET_ADDRESS=${contracts.mockTokenFaucet}`,
  `MOCK_ADAPTER_ADDRESS=${contracts.mockExactOutputAdapter}`,
  `SUPPORTED_PAYMENT_TOKENS_JSON=${JSON.stringify(supportedTokens)}`,
  `NEXT_PUBLIC_PAYMENT_ROUTER_ADDRESS=${contracts.paymentRouter}`,
  `NEXT_PUBLIC_MERCHANT_REGISTRY_ADDRESS=${contracts.merchantRegistry}`,
  `NEXT_PUBLIC_MOCK_KRW_ADDRESS=${contracts.mockKRW}`,
  `NEXT_PUBLIC_MOCK_USDC_ADDRESS=${contracts.mockUSDC}`,
  `NEXT_PUBLIC_MOCK_ALT_ADDRESS=${contracts.mockALT}`,
  `NEXT_PUBLIC_MOCK_TOKEN_FAUCET_ADDRESS=${contracts.mockTokenFaucet}`,
  'NEXT_PUBLIC_ALLOW_TEST_CONTRACTS=true',
];

await appendFile(resolve(environmentPath), `${lines.join('\n')}\n`, {
  encoding: 'utf8',
});
await chmod(resolve(environmentPath), 0o600);
