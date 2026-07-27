import { createGiwaPublicClient } from '@giwapay/chains';
import { type Address, type PublicClient } from 'viem';

import type { AppConfig } from './env.js';

export function createChainClient(config: AppConfig): PublicClient {
  return createGiwaPublicClient({
    primaryUrl: config.GIWA_RPC_URL,
    fallbackUrls: config.rpcFallbackUrls,
    timeoutMs: config.RPC_TIMEOUT_MS,
    retryCount: config.RPC_RETRY_COUNT,
    retryDelayMs: 250,
  });
}

export function explorerTransactionUrl(
  transactionHash: `0x${string}`,
  explorerBaseUrl: string | null,
) {
  return explorerBaseUrl ? `${explorerBaseUrl}/tx/${transactionHash}` : null;
}

export function normalizeAddress(address: string): Address {
  return address.toLowerCase() as Address;
}
