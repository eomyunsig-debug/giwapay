import { paymentRouterAbi } from './abi.js';
import { AsyncTtlCache } from './cache.js';
import { normalizeAddress } from './chain.js';
import { HttpError } from './errors.js';
import type { AppServices } from './types.js';

const configurationCaches = new WeakMap<
  object,
  AsyncTtlCache<Awaited<ReturnType<typeof readRouterConfiguration>>>
>();

export async function readRouterConfiguration(services: AppServices) {
  const router = services.config.PAYMENT_ROUTER_ADDRESS;
  const merchantRegistry = services.config.MERCHANT_REGISTRY_ADDRESS;
  const adapterRegistry = services.config.ADAPTER_REGISTRY_ADDRESS;
  if (!router || !merchantRegistry || !adapterRegistry) {
    throw new HttpError(
      503,
      'router_configuration_incomplete',
      'PaymentRouter and registry addresses must all be configured',
    );
  }
  try {
    const [onchainFeeBps, onchainMerchantRegistry, onchainAdapterRegistry] = await Promise.all([
      services.chainClient.readContract({
        address: router,
        abi: paymentRouterAbi,
        functionName: 'platformFeeBps',
      }),
      services.chainClient.readContract({
        address: router,
        abi: paymentRouterAbi,
        functionName: 'merchantRegistry',
      }),
      services.chainClient.readContract({
        address: router,
        abi: paymentRouterAbi,
        functionName: 'adapterRegistry',
      }),
    ]);
    return {
      feeBps: onchainFeeBps,
      merchantRegistry: normalizeAddress(onchainMerchantRegistry),
      adapterRegistry: normalizeAddress(onchainAdapterRegistry),
      matches:
        onchainFeeBps === services.config.PLATFORM_FEE_BPS &&
        normalizeAddress(onchainMerchantRegistry) === merchantRegistry &&
        normalizeAddress(onchainAdapterRegistry) === adapterRegistry,
    };
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(
      503,
      'router_configuration_unverifiable',
      'PaymentRouter immutable configuration could not be verified',
    );
  }
}

export async function assertRouterConfiguration(services: AppServices) {
  const configuration = await readRouterConfiguration(services);
  if (!configuration.matches) {
    throw new HttpError(
      503,
      'router_configuration_mismatch',
      'Configured fee or registry address does not match PaymentRouter immutables',
    );
  }
  return configuration;
}

export async function assertCachedRouterConfiguration(services: AppServices) {
  let cache = configurationCaches.get(services.chainClient);
  if (!cache) {
    cache = new AsyncTtlCache(1);
    configurationCaches.set(services.chainClient, cache);
  }
  return cache.get(
    'immutable-router-configuration',
    services.config.ROUTER_CONFIGURATION_CACHE_TTL_MS,
    () => assertRouterConfiguration(services),
  );
}
