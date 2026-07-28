import {
  createPublicClient,
  defineChain,
  fallback,
  getAddress,
  http,
  type Address,
  type Chain,
  type EIP1193Provider,
  type PublicClient,
} from 'viem';
import { z } from 'zod';

export const GIWA_SEPOLIA_CHAIN_ID = 91_342 as const;
export const GIWA_SEPOLIA_CHAIN_ID_HEX = '0x164ce' as const;
export const GIWA_SEPOLIA_NAME = 'GIWA Sepolia' as const;
export const GIWA_SEPOLIA_NATIVE_CURRENCY = {
  name: 'Ether',
  symbol: 'ETH',
  decimals: 18,
} as const;
export const GIWA_SEPOLIA_PUBLIC_RPC_URL = 'https://sepolia-rpc.giwa.io' as const;
export const GIWA_SEPOLIA_EXPLORER_URL = 'https://sepolia-explorer.giwa.io' as const;

export const GIWA_RPC_ENV_NAME = 'GIWA_RPC_URL' as const;
export const GIWA_FALLBACK_RPC_ENV_NAME = 'GIWA_RPC_FALLBACK_URLS' as const;

export interface GiwaRpcOptions {
  /** Primary provider. Prefer a dedicated endpoint in production. */
  primaryUrl?: string;
  /** Secondary endpoints, ordered from most to least preferred. */
  fallbackUrls?: readonly string[];
  /** Per-request timeout. */
  timeoutMs?: number;
  /** Retries performed by each HTTP transport. */
  retryCount?: number;
  /** Base delay used by viem's exponential retry schedule. */
  retryDelayMs?: number;
}

export interface GiwaEnvironment {
  GIWA_RPC_URL?: string;
  GIWA_RPC_FALLBACK_URLS?: string;
}

const normalizeRpcUrl = (value: string): string => {
  const url = new URL(value);
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error(`Unsupported RPC protocol: ${url.protocol}`);
  }
  return url.toString().replace(/\/$/, '');
};

const unique = <T>(values: readonly T[]): T[] => [...new Set(values)];

/**
 * Resolves RPC providers without treating the rate-limited public endpoint as a
 * production-grade service. `GIWA_RPC_URL` always wins when supplied.
 */
export function resolveGiwaRpcUrls(
  options: GiwaRpcOptions = {},
  environment: GiwaEnvironment = {},
): string[] {
  const primary = options.primaryUrl ?? environment.GIWA_RPC_URL ?? GIWA_SEPOLIA_PUBLIC_RPC_URL;
  const environmentFallbacks =
    environment.GIWA_RPC_FALLBACK_URLS?.split(',')
      .map((value) => value.trim())
      .filter(Boolean) ?? [];
  const fallbacks = options.fallbackUrls ?? environmentFallbacks;

  return unique([primary, ...fallbacks]).map(normalizeRpcUrl);
}

export function createGiwaSepoliaChain(
  rpcUrls: readonly string[] = [GIWA_SEPOLIA_PUBLIC_RPC_URL],
): Chain {
  const normalized = unique(rpcUrls).map(normalizeRpcUrl);
  if (normalized.length === 0) {
    throw new Error('At least one GIWA RPC URL is required');
  }

  return defineChain({
    id: GIWA_SEPOLIA_CHAIN_ID,
    name: GIWA_SEPOLIA_NAME,
    nativeCurrency: GIWA_SEPOLIA_NATIVE_CURRENCY,
    rpcUrls: {
      default: { http: normalized },
    },
    blockExplorers: {
      default: {
        name: 'GIWA Sepolia Explorer',
        url: GIWA_SEPOLIA_EXPLORER_URL,
      },
    },
    testnet: true,
  });
}

export const giwaSepolia = createGiwaSepoliaChain();

export function createGiwaPublicClient(
  options: GiwaRpcOptions = {},
  environment: GiwaEnvironment = {},
): PublicClient {
  const urls = resolveGiwaRpcUrls(options, environment);
  const timeout = options.timeoutMs ?? 10_000;
  const retryCount = options.retryCount ?? 3;
  const retryDelay = options.retryDelayMs ?? 250;

  return createPublicClient({
    chain: createGiwaSepoliaChain(urls),
    // Indexer finality and confirmed-state reads must observe the current
    // provider head rather than viem's short in-memory block-number cache.
    cacheTime: 0,
    transport: fallback(
      urls.map((url) =>
        http(url, {
          timeout,
          retryCount,
          retryDelay,
        }),
      ),
      {
        rank: {
          interval: 30_000,
          sampleCount: 8,
          timeout: timeout + 1_000,
          weights: {
            latency: 0.35,
            stability: 0.65,
          },
        },
        retryCount: 1,
        retryDelay,
      },
    ),
  });
}

export interface Eip6963ProviderInfo {
  uuid: string;
  name: string;
  icon: string;
  rdns: string;
}

export interface Eip6963ProviderDetail {
  info: Eip6963ProviderInfo;
  provider: EIP1193Provider;
}

/**
 * Future GIWA Wallet integration boundary. It deliberately exposes only a
 * standard EIP-1193 provider and does not imply that an official wallet SDK is
 * available or integrated.
 */
export interface GiwaWalletProviderResolver {
  readonly id: string;
  resolve(): Promise<EIP1193Provider | undefined>;
}

export interface Eip6963AnnounceProviderEvent extends Event {
  detail: Eip6963ProviderDetail;
}

type Eip6963EventTarget = Pick<
  Window,
  'addEventListener' | 'removeEventListener' | 'dispatchEvent'
>;

/**
 * Discovers injected wallets through EIP-6963. Legacy `window.ethereum` is
 * appended only when it was not already announced.
 */
export async function discoverInjectedProviders(
  target: Eip6963EventTarget,
  legacyProvider?: EIP1193Provider,
  timeoutMs = 80,
): Promise<Eip6963ProviderDetail[]> {
  const providers = new Map<string, Eip6963ProviderDetail>();
  const onProvider = (event: Event): void => {
    const detail = (event as Eip6963AnnounceProviderEvent).detail;
    if (detail?.provider && detail.info?.uuid && typeof detail.provider.request === 'function') {
      providers.set(detail.info.uuid, detail);
    }
  };

  target.addEventListener('eip6963:announceProvider', onProvider);
  target.dispatchEvent(new Event('eip6963:requestProvider'));
  await new Promise((resolve) => globalThis.setTimeout(resolve, timeoutMs));
  target.removeEventListener('eip6963:announceProvider', onProvider);

  if (
    legacyProvider &&
    ![...providers.values()].some((candidate) => candidate.provider === legacyProvider)
  ) {
    providers.set('legacy-injected-provider', {
      info: {
        uuid: 'legacy-injected-provider',
        name: 'Injected wallet',
        icon: '',
        rdns: 'legacy.injected',
      },
      provider: legacyProvider,
    });
  }

  return [...providers.values()];
}

export const giwaAddEthereumChainParameter = {
  chainId: GIWA_SEPOLIA_CHAIN_ID_HEX,
  chainName: GIWA_SEPOLIA_NAME,
  nativeCurrency: GIWA_SEPOLIA_NATIVE_CURRENCY,
  rpcUrls: [GIWA_SEPOLIA_PUBLIC_RPC_URL],
  blockExplorerUrls: [GIWA_SEPOLIA_EXPLORER_URL],
} as const;

const getErrorCode = (error: unknown): number | undefined => {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return undefined;
  }
  return typeof error.code === 'number' ? error.code : undefined;
};

/**
 * Switches to GIWA Sepolia, adding it when the wallet does not know the chain.
 */
export async function ensureGiwaSepolia(
  provider: Pick<EIP1193Provider, 'request'>,
  rpcUrls: readonly string[] = [GIWA_SEPOLIA_PUBLIC_RPC_URL],
): Promise<void> {
  const request = provider.request as unknown as (args: {
    method: string;
    params?: readonly unknown[];
  }) => Promise<unknown>;
  try {
    await request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: GIWA_SEPOLIA_CHAIN_ID_HEX }],
    });
  } catch (error) {
    if (getErrorCode(error) !== 4902) {
      throw error;
    }
    await request({
      method: 'wallet_addEthereumChain',
      params: [
        {
          ...giwaAddEthereumChainParameter,
          rpcUrls: resolveGiwaRpcUrls({
            primaryUrl: rpcUrls[0] ?? GIWA_SEPOLIA_PUBLIC_RPC_URL,
            fallbackUrls: rpcUrls.slice(1),
          }),
        },
      ],
    });
  }
}

export interface TokenConfig {
  address: Address;
  symbol: string;
  name: string;
  decimals: number;
  testOnly: boolean;
  displayLabel: string;
}

const tokenConfigSchema = z.object({
  address: z
    .string()
    .regex(/^0x[a-fA-F0-9]{40}$/)
    .transform((value) => getAddress(value)),
  symbol: z.string().trim().min(1).max(20),
  name: z.string().trim().min(1).max(80),
  decimals: z.number().int().min(0).max(36),
  testOnly: z.boolean(),
  displayLabel: z.string().trim().min(1).max(120).optional(),
});

export type DemoTokenSymbol = 'MockKRW' | 'MockUSDC' | 'MockALT';
export type DemoTokenAddresses = Partial<Record<DemoTokenSymbol, Address>>;

const demoTokenMetadata: Record<DemoTokenSymbol, Omit<TokenConfig, 'address'>> = {
  MockKRW: {
    symbol: 'MockKRW',
    name: 'MockKRW',
    decimals: 6,
    testOnly: true,
    displayLabel: 'Testnet demo · MockKRW',
  },
  MockUSDC: {
    symbol: 'MockUSDC',
    name: 'MockUSDC',
    decimals: 6,
    testOnly: true,
    displayLabel: 'Testnet demo · MockUSDC',
  },
  MockALT: {
    symbol: 'MockALT',
    name: 'MockALT',
    decimals: 18,
    testOnly: true,
    displayLabel: 'Testnet demo · MockALT',
  },
};

/**
 * Central token registry. No addresses are invented: a token is available only
 * after an address is supplied from a verified deployment manifest.
 */
export function createDemoTokenRegistry(
  addresses: DemoTokenAddresses,
): ReadonlyMap<Address, TokenConfig> {
  const entries = Object.entries(addresses).flatMap(([symbol, address]) => {
    if (!address) return [];
    const metadata = demoTokenMetadata[symbol as DemoTokenSymbol];
    const checksummedAddress = getAddress(address);
    return [[checksummedAddress, { address: checksummedAddress, ...metadata }]] as const;
  });
  return new Map(entries);
}

/**
 * Parses public deployment token metadata. This is the production extension
 * point for verified official assets; addresses are never inferred.
 */
export function parseTokenRegistryJson(
  json: string,
  options: { production?: boolean } = {},
): ReadonlyMap<Address, TokenConfig> {
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(json);
  } catch {
    throw new Error('PAYMENT_TOKENS_JSON must be valid JSON');
  }
  const parsed = z.array(tokenConfigSchema).max(100).parse(parsedJson);
  if (options.production && parsed.some((token) => token.testOnly)) {
    throw new Error('Production token configuration cannot include testOnly assets');
  }
  const registry = new Map<Address, TokenConfig>();
  for (const token of parsed) {
    if (registry.has(token.address)) {
      throw new Error(`Duplicate payment token address: ${token.address}`);
    }
    registry.set(token.address, {
      ...token,
      displayLabel:
        token.displayLabel ?? (token.testOnly ? `Testnet demo · ${token.name}` : token.name),
    });
  }
  return registry;
}

export interface GasSponsorshipRequest {
  chainId: number;
  from: Address;
  to: Address;
  data: `0x${string}`;
  value?: bigint;
}

export type GasSponsorshipResult =
  | {
      sponsored: true;
      transaction: {
        to: Address;
        data: `0x${string}`;
        value: bigint;
      };
    }
  | {
      sponsored: false;
      reason: string;
    };

/**
 * Extension boundary for a future, verified paymaster integration.
 * The MVP does not claim or simulate gasless transactions.
 */
export interface GasSponsorshipProvider {
  readonly id: string;
  sponsor(request: GasSponsorshipRequest): Promise<GasSponsorshipResult>;
}

export class DisabledGasSponsorshipProvider implements GasSponsorshipProvider {
  readonly id = 'disabled';

  async sponsor(): Promise<GasSponsorshipResult> {
    return {
      sponsored: false,
      reason: 'Gas sponsorship is not enabled for this deployment.',
    };
  }
}
