import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { adapterRegistryAbi, erc20MetadataAbi, zeroAddress } from '../abi.js';
import { normalizeAddress } from '../chain.js';
import { HttpError } from '../errors.js';
import type { SupportedPaymentToken } from '../env.js';
import type { AppServices } from '../types.js';

const addressSchema = z
  .string()
  .regex(/^0x[0-9a-fA-F]{40}$/)
  .transform((value) => normalizeAddress(value));
const querySchema = z.object({
  settlementToken: addressSchema.optional(),
});

async function verifyTokenMetadata(
  services: AppServices,
  route: SupportedPaymentToken,
  blockNumber: bigint,
) {
  const [name, symbol, decimals] = await Promise.all([
    services.chainClient.readContract({
      address: route.token,
      abi: erc20MetadataAbi,
      functionName: 'name',
      blockNumber,
    }),
    services.chainClient.readContract({
      address: route.token,
      abi: erc20MetadataAbi,
      functionName: 'symbol',
      blockNumber,
    }),
    services.chainClient.readContract({
      address: route.token,
      abi: erc20MetadataAbi,
      functionName: 'decimals',
      blockNumber,
    }),
  ]);
  return (
    name === route.tokenName && symbol === route.tokenSymbol && decimals === route.tokenDecimals
  );
}

async function verifyRoute(services: AppServices, route: SupportedPaymentToken) {
  if (!route.adapter) {
    return route.token === route.settlementToken;
  }
  const registry = services.config.ADAPTER_REGISTRY_ADDRESS;
  if (!registry) return false;
  try {
    const config = await services.chainClient.readContract({
      address: registry,
      abi: adapterRegistryAbi,
      functionName: 'getAdapter',
      args: [route.adapter],
    });
    if (
      !config.enabled ||
      config.identifier !== route.adapterIdentifier ||
      config.testOnly !== route.testOnly
    ) {
      return false;
    }
    await services.chainClient.readContract({
      address: registry,
      abi: adapterRegistryAbi,
      functionName: 'validateAdapter',
      args: [route.adapter, route.token, route.settlementToken, 1n],
    });
    return true;
  } catch {
    return false;
  }
}

export async function registerPaymentMethodRoutes(app: FastifyInstance, services: AppServices) {
  app.get(
    '/v1/payment-methods',
    {
      schema: {
        tags: ['Checkout'],
        summary: 'List chain-verified supported payment routes',
        querystring: querySchema,
      },
    },
    async (request) => {
      const query = querySchema.parse(request.query);
      const configured = services.config.supportedPaymentTokens.filter(
        (route) => !query.settlementToken || route.settlementToken === query.settlementToken,
      );
      const head = await services.chainClient.getBlockNumber();
      const confirmations = BigInt(services.config.CHAIN_CONFIRMATIONS);
      if (head < confirmations) {
        throw new HttpError(
          503,
          'confirmed_chain_unavailable',
          'Confirmed chain state is unavailable',
        );
      }
      const blockNumber = head - confirmations;
      const metadataByToken = new Map<string, boolean>();
      await Promise.all(
        [...new Set(configured.flatMap((route) => [route.token, route.settlementToken]))].map(
          async (token) => {
            const route = services.config.supportedPaymentTokens.find(
              (candidate) => candidate.token === token,
            );
            if (!route) {
              metadataByToken.set(token, false);
              return;
            }
            try {
              metadataByToken.set(token, await verifyTokenMetadata(services, route, blockNumber));
            } catch {
              metadataByToken.set(token, false);
            }
          },
        ),
      );
      const verified = (
        await Promise.all(
          configured.map(async (route) =>
            metadataByToken.get(route.token) &&
            metadataByToken.get(route.settlementToken) &&
            (await verifyRoute(services, route))
              ? route
              : null,
          ),
        )
      ).filter((route): route is SupportedPaymentToken => route !== null);
      const metadata = new Map(
        services.config.supportedPaymentTokens.map((route) => [
          route.token,
          {
            address: route.token,
            symbol: route.tokenSymbol,
            name: route.tokenName,
            decimals: route.tokenDecimals,
            testOnly: route.testOnly,
          },
        ]),
      );
      return {
        data: verified.map((route) => ({
          token: metadata.get(route.token)!,
          settlementToken: metadata.get(route.settlementToken)!,
          route: {
            adapter: route.adapter ?? zeroAddress,
            adapterIdentifier: route.adapterIdentifier,
            defaultSlippageBps: route.defaultSlippageBps,
            maxInputCap: route.maxInputCap ?? null,
          },
        })),
        verifiedAtBlock: blockNumber.toString(),
      };
    },
  );
}
