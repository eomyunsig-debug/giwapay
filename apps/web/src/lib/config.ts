import {
  createDemoTokenRegistry,
  createGiwaSepoliaChain,
  GIWA_SEPOLIA_EXPLORER_URL,
  parseTokenRegistryJson,
  resolveGiwaRpcUrls,
  type DemoTokenAddresses,
} from '@giwapay/chains';
import type { Address } from 'viem';

const configuredFallbacks =
  process.env.NEXT_PUBLIC_GIWA_RPC_FALLBACK_URLS?.split(',')
    .map((value) => value.trim())
    .filter(Boolean) ?? [];

export const giwaRpcUrls = resolveGiwaRpcUrls({
  ...(process.env.NEXT_PUBLIC_GIWA_RPC_URL
    ? { primaryUrl: process.env.NEXT_PUBLIC_GIWA_RPC_URL }
    : {}),
  fallbackUrls: configuredFallbacks,
});

export const webGiwaSepolia = createGiwaSepoliaChain(giwaRpcUrls);

const optionalAddress = (value?: string): Address | undefined =>
  value && /^0x[a-fA-F0-9]{40}$/.test(value) ? (value as Address) : undefined;

const tokenAddresses: DemoTokenAddresses = {};
const mockKrwAddress = optionalAddress(process.env.NEXT_PUBLIC_MOCK_KRW_ADDRESS);
const mockUsdcAddress = optionalAddress(process.env.NEXT_PUBLIC_MOCK_USDC_ADDRESS);
const mockAltAddress = optionalAddress(process.env.NEXT_PUBLIC_MOCK_ALT_ADDRESS);
if (mockKrwAddress) tokenAddresses.MockKRW = mockKrwAddress;
if (mockUsdcAddress) tokenAddresses.MockUSDC = mockUsdcAddress;
if (mockAltAddress) tokenAddresses.MockALT = mockAltAddress;

const publicTokenConfiguration = process.env.NEXT_PUBLIC_PAYMENT_TOKENS_JSON?.trim();
const allowTestContracts = process.env.NEXT_PUBLIC_ALLOW_TEST_CONTRACTS === 'true';
if (!allowTestContracts && Object.keys(tokenAddresses).length > 0) {
  throw new Error(
    'NEXT_PUBLIC_MOCK_* addresses require explicit NEXT_PUBLIC_ALLOW_TEST_CONTRACTS=true',
  );
}

export const paymentTokenRegistry = publicTokenConfiguration
  ? parseTokenRegistryJson(publicTokenConfiguration, {
      production: !allowTestContracts,
    })
  : createDemoTokenRegistry(tokenAddresses);
export const configuredDemoTokens = [...paymentTokenRegistry.values()];

export const getConfiguredToken = (address: string) =>
  configuredDemoTokens.find((token) => token.address.toLowerCase() === address.toLowerCase());

export const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://127.0.0.1:3001';

const configuredExplorer = process.env.NEXT_PUBLIC_GIWA_EXPLORER_URL;
export const GIWA_EXPLORER_URL =
  configuredExplorer === undefined
    ? GIWA_SEPOLIA_EXPLORER_URL
    : configuredExplorer.trim() || undefined;
export const transactionExplorerUrl = (hash: string): string | undefined =>
  GIWA_EXPLORER_URL ? `${GIWA_EXPLORER_URL}/tx/${hash}` : undefined;

export const MERCHANT_REGISTRY_ADDRESS = optionalAddress(
  process.env.NEXT_PUBLIC_MERCHANT_REGISTRY_ADDRESS,
);

export const MOCK_TOKEN_FAUCET_ADDRESS = optionalAddress(
  process.env.NEXT_PUBLIC_MOCK_TOKEN_FAUCET_ADDRESS,
);

export const DEFAULT_SPLIT_ID =
  process.env.NEXT_PUBLIC_DEFAULT_SPLIT_ID &&
  /^0x[a-fA-F0-9]{64}$/.test(process.env.NEXT_PUBLIC_DEFAULT_SPLIT_ID)
    ? (process.env.NEXT_PUBLIC_DEFAULT_SPLIT_ID as `0x${string}`)
    : (`0x${'00'.repeat(32)}` as const);
