import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import {
  createDatabase,
  eq,
  paymentIntents,
  refundRequests,
  webhookDeliveries,
  webhookEvents,
} from '@giwapay/db';
import { createGiwaSepoliaChain, GIWA_SEPOLIA_CHAIN_ID } from '@giwapay/chains';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import type { PoolClient } from 'pg';
import pino from 'pino';
import { SiweMessage } from 'siwe';
import {
  createPublicClient,
  createTestClient,
  createWalletClient,
  getAddress,
  http,
  parseAbi,
  parseEther,
  zeroAddress,
  zeroHash,
  type Address,
  type Hex,
} from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildApp } from './app.js';
import { createChainClient } from './chain.js';
import { signWebhook } from './crypto.js';
import { loadConfig } from './env.js';
import { ChainIndexer } from './indexer-service.js';
import { PaymentIntentSigner } from './signer.js';
import type { AppServices } from './types.js';
import { claimWebhookDeliveries, deliverWebhook } from './webhooks.js';

const integrationEnabled = process.env.RUN_ANVIL_INTEGRATION === 'true';
const requiredEnvironment = [
  'TEST_DATABASE_URL',
  'ANVIL_RPC_URL',
  'ANVIL_DEPLOYMENT_MANIFEST',
  'SESSION_SECRET',
  'API_KEY_PEPPER',
  'WEBHOOK_ENCRYPTION_KEY',
  'PAYMENT_INTENT_SIGNER_PRIVATE_KEY',
] as const;

if (integrationEnabled) {
  const missing = requiredEnvironment.filter((name) => !process.env[name]);
  if (missing.length > 0) {
    throw new Error(`RUN_ANVIL_INTEGRATION=true requires: ${missing.join(', ')}`);
  }
}

const run = integrationEnabled ? describe.sequential : describe.skip;

type DeploymentManifest = {
  chainId: number;
  mode: string;
  contracts: {
    merchantRegistry: string;
    adapterRegistry: string;
    paymentRouter: string;
    mockKRW: string;
    mockUSDC: string;
    mockALT: string;
    mockTokenFaucet: string;
    mockExactOutputAdapter: string;
  };
};

type Deployment = {
  merchantRegistry: Address;
  adapterRegistry: Address;
  paymentRouter: Address;
  mockKRW: Address;
  mockUSDC: Address;
  mockALT: Address;
  mockTokenFaucet: Address;
  mockExactOutputAdapter: Address;
};

type ReceivedWebhook = {
  headers: IncomingHttpHeaders;
  rawBody: string;
};

type TransactionRequest = {
  to: Address;
  data: Hex;
  value: string;
  chainId?: number;
};

type PaymentIntentCreation = {
  paymentIntent: {
    id: string;
    paymentId: Hex;
    settlement: { token: Address; amount: string };
    platformFee: string;
  };
};

type QuoteResponse = {
  quoteId: string;
  tokenIn: Address;
  settlementToken: Address;
  exactMerchantAmount: string;
  platformFee: string;
  estimatedInputAmount: string;
  maximumInputAmount: string;
  adapter: Address;
  adapterIdentifier: string;
};

type PreparationResponse = {
  approval: {
    required: boolean;
    token: Address;
    spender: Address;
    amount: string;
    transaction: Omit<TransactionRequest, 'chainId'>;
  };
  payment: { transaction: TransactionRequest };
};

type RefundPreparation = {
  refund: {
    id: string;
    refundId: Hex;
    amount: string;
    status: string;
  };
  approval: Omit<TransactionRequest, 'chainId'>;
  transaction: TransactionRequest;
};

const merchantRegistryWriteAbi = parseAbi([
  'function registerMerchant(address payoutAddress,address delegatedSigner)',
]);
const faucetAbi = parseAbi(['function claim(address token)']);
const erc20Abi = parseAbi([
  'function balanceOf(address account) view returns (uint256)',
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
]);

function checkedAddress(value: string, label: string): Address {
  if (!/^0x[a-fA-F0-9]{40}$/.test(value)) {
    throw new Error(`Integration deployment is missing ${label}`);
  }
  return getAddress(value);
}

function parseDeployment(manifest: DeploymentManifest): Deployment {
  if (manifest.chainId !== GIWA_SEPOLIA_CHAIN_ID || manifest.mode !== 'local-anvil') {
    throw new Error('Integration manifest must be a GIWA 91342 local-anvil deployment');
  }
  return {
    merchantRegistry: checkedAddress(manifest.contracts.merchantRegistry, 'MerchantRegistry'),
    adapterRegistry: checkedAddress(manifest.contracts.adapterRegistry, 'AdapterRegistry'),
    paymentRouter: checkedAddress(manifest.contracts.paymentRouter, 'PaymentRouter'),
    mockKRW: checkedAddress(manifest.contracts.mockKRW, 'MockKRW'),
    mockUSDC: checkedAddress(manifest.contracts.mockUSDC, 'MockUSDC'),
    mockALT: checkedAddress(manifest.contracts.mockALT, 'MockALT'),
    mockTokenFaucet: checkedAddress(manifest.contracts.mockTokenFaucet, 'MockTokenFaucet'),
    mockExactOutputAdapter: checkedAddress(
      manifest.contracts.mockExactOutputAdapter,
      'MockFixedRateExactOutputAdapter',
    ),
  };
}

function cookieHeader(setCookie: string | string[] | number | undefined): string {
  const values = Array.isArray(setCookie)
    ? setCookie
    : typeof setCookie === 'string'
      ? [setCookie]
      : [];
  return values.map((value) => value.split(';', 1)[0]).join('; ');
}

async function startWebhookReceiver(
  received: ReceivedWebhook[],
): Promise<{ server: Server; url: string }> {
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    received.push({
      headers: request.headers,
      rawBody: Buffer.concat(chunks).toString('utf8'),
    });
    response.writeHead(204);
    response.end();
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Webhook receiver did not bind a TCP port');
  }
  return { server, url: `http://127.0.0.1:${address.port}/giwapay` };
}

function assertSignedWebhook(received: ReceivedWebhook, secret: string, expectedType: string) {
  const signature = received.headers['giwapay-signature'];
  const eventId = received.headers['giwapay-event-id'];
  const idempotencyKey = received.headers['idempotency-key'];
  expect(typeof signature).toBe('string');
  expect(typeof eventId).toBe('string');
  expect(idempotencyKey).toBe(eventId);
  const timestamp = /^t=(\d+),v1=[a-f0-9]{64}$/.exec(String(signature))?.[1];
  expect(timestamp).toBeTruthy();
  expect(signature).toBe(signWebhook(Number(timestamp), received.rawBody, secret));
  const payload = JSON.parse(received.rawBody) as {
    id: string;
    type: string;
    data: Record<string, unknown>;
  };
  expect(payload.id).toBe(eventId);
  expect(payload.type).toBe(expectedType);
  return payload;
}

run('Anvil payment, indexer, webhook, and refund integration', () => {
  const origin = 'http://localhost:3000';
  const databaseUrl = process.env.TEST_DATABASE_URL!;
  const rpcUrl = process.env.ANVIL_RPC_URL!;
  const manifestPath = process.env.ANVIL_DEPLOYMENT_MANIFEST!;
  const merchantAccount = privateKeyToAccount(generatePrivateKey());
  const customerAccount = privateKeyToAccount(generatePrivateKey());
  const receivedWebhooks: ReceivedWebhook[] = [];

  let deployment: Deployment;
  let database: ReturnType<typeof createDatabase>;
  let databaseLock: PoolClient;
  let services: AppServices;
  let app: Awaited<ReturnType<typeof buildApp>>;
  let webhookServer: Server;
  let webhookUrl: string;

  beforeAll(async () => {
    const parsedRpcUrl = new URL(rpcUrl);
    if (
      !['http:', 'https:'].includes(parsedRpcUrl.protocol) ||
      !['127.0.0.1', 'localhost', '::1'].includes(parsedRpcUrl.hostname)
    ) {
      throw new Error('Anvil integration requires a loopback JSON-RPC endpoint');
    }
    const parsedDatabaseUrl = new URL(databaseUrl);
    if (
      !['127.0.0.1', 'localhost', '::1'].includes(parsedDatabaseUrl.hostname) ||
      !parsedDatabaseUrl.pathname.toLowerCase().includes('test')
    ) {
      throw new Error(
        'Anvil integration requires a loopback PostgreSQL database whose name contains "test"',
      );
    }

    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as DeploymentManifest;
    deployment = parseDeployment(manifest);
    database = createDatabase(databaseUrl, { max: 4 });
    databaseLock = await database.pool.connect();
    await databaseLock.query("select pg_advisory_lock(hashtext('giwapay-anvil-integration'))");
    await migrate(database.db, {
      migrationsFolder: fileURLToPath(new URL('../../../packages/db/migrations', import.meta.url)),
    });
    await databaseLock.query(`
      TRUNCATE TABLE
        auth_nonces,
        sessions,
        api_keys,
        refund_requests,
        payment_intents,
        webhook_deliveries,
        webhook_events,
        webhook_endpoints,
        chain_events,
        chain_blocks,
        chain_cursors,
        merchants
      RESTART IDENTITY CASCADE
    `);

    const supportedPaymentTokens = [
      {
        token: deployment.mockKRW,
        tokenSymbol: 'MockKRW',
        tokenName: 'GiwaPay Testnet Mock KRW',
        tokenDecimals: 6,
        settlementToken: deployment.mockKRW,
        adapterIdentifier: 'direct',
        adapterData: '0x',
        defaultSlippageBps: 0,
        testOnly: true,
      },
      {
        token: deployment.mockUSDC,
        tokenSymbol: 'MockUSDC',
        tokenName: 'GiwaPay Testnet Mock USDC',
        tokenDecimals: 6,
        settlementToken: deployment.mockKRW,
        adapter: deployment.mockExactOutputAdapter,
        adapterIdentifier: 'mock-fixed-rate-v1',
        adapterData: '0x',
        maxInputCap: '1000000000000000',
        defaultSlippageBps: 100,
        testOnly: true,
      },
      {
        token: deployment.mockALT,
        tokenSymbol: 'MockALT',
        tokenName: 'GiwaPay Testnet Mock ALT',
        tokenDecimals: 18,
        settlementToken: deployment.mockKRW,
        adapter: deployment.mockExactOutputAdapter,
        adapterIdentifier: 'mock-fixed-rate-v1',
        adapterData: '0x',
        maxInputCap: '1000000000000000000000000000',
        defaultSlippageBps: 100,
        testOnly: true,
      },
    ];
    const config = loadConfig({
      NODE_ENV: 'test',
      LOG_LEVEL: 'silent',
      DATABASE_URL: databaseUrl,
      ALLOWED_ORIGINS: origin,
      WEB_BASE_URL: origin,
      PUBLIC_API_URL: 'http://localhost:3001',
      SESSION_SECRET: process.env.SESSION_SECRET!,
      API_KEY_PEPPER: process.env.API_KEY_PEPPER!,
      WEBHOOK_ENCRYPTION_KEY: process.env.WEBHOOK_ENCRYPTION_KEY!,
      GIWA_CHAIN_ID: String(GIWA_SEPOLIA_CHAIN_ID),
      GIWA_RPC_URL: rpcUrl,
      RPC_TIMEOUT_MS: '5000',
      RPC_RETRY_COUNT: '0',
      CHAIN_EXPLORER_URL: '',
      PAYMENT_ROUTER_ADDRESS: deployment.paymentRouter,
      MERCHANT_REGISTRY_ADDRESS: deployment.merchantRegistry,
      ADAPTER_REGISTRY_ADDRESS: deployment.adapterRegistry,
      PAYMENT_INTENT_SIGNER_PRIVATE_KEY: process.env.PAYMENT_INTENT_SIGNER_PRIVATE_KEY!,
      PLATFORM_FEE_BPS: '50',
      SUPPORTED_PAYMENT_TOKENS_JSON: JSON.stringify(supportedPaymentTokens),
      ALLOW_TEST_CONTRACTS: 'true',
      CHAIN_START_BLOCK: '0',
      CHAIN_CONFIRMATIONS: '1',
      INDEXER_BATCH_SIZE: '2000',
      WEBHOOK_MAX_ATTEMPTS: '2',
      WEBHOOK_TIMEOUT_MS: '5000',
    });
    services = {
      config,
      db: database.db,
      pool: database.pool,
      chainClient: createChainClient(config),
      intentSigner: new PaymentIntentSigner(config),
    };
    app = await buildApp(services);
    const receiver = await startWebhookReceiver(receivedWebhooks);
    webhookServer = receiver.server;
    webhookUrl = receiver.url;
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    if (webhookServer) {
      await new Promise<void>((resolve, reject) =>
        webhookServer.close((error) => (error ? reject(error) : resolve())),
      );
    }
    if (databaseLock) {
      await databaseLock.query("select pg_advisory_unlock(hashtext('giwapay-anvil-integration'))");
      databaseLock.release();
    }
    await database?.close();
  });

  it('proves exact-output settlement through verified webhooks and a merchant-funded refund', async () => {
    const chain = createGiwaSepoliaChain([rpcUrl]);
    const publicClient = createPublicClient({
      chain,
      transport: http(rpcUrl),
    });
    const testClient = createTestClient({
      chain,
      mode: 'anvil',
      transport: http(rpcUrl),
    });
    const merchantWallet = createWalletClient({
      account: merchantAccount,
      chain,
      transport: http(rpcUrl),
    });
    const customerWallet = createWalletClient({
      account: customerAccount,
      chain,
      transport: http(rpcUrl),
    });
    expect(await publicClient.getChainId()).toBe(GIWA_SEPOLIA_CHAIN_ID);
    await Promise.all([
      testClient.setBalance({
        address: merchantAccount.address,
        value: parseEther('10'),
      }),
      testClient.setBalance({
        address: customerAccount.address,
        value: parseEther('10'),
      }),
    ]);

    const tokenMetadata = await Promise.all(
      [deployment.mockKRW, deployment.mockUSDC, deployment.mockALT].map(async (token) => ({
        name: await publicClient.readContract({
          address: token,
          abi: erc20Abi,
          functionName: 'name',
        }),
        symbol: await publicClient.readContract({
          address: token,
          abi: erc20Abi,
          functionName: 'symbol',
        }),
        decimals: await publicClient.readContract({
          address: token,
          abi: erc20Abi,
          functionName: 'decimals',
        }),
      })),
    );
    expect(tokenMetadata).toEqual([
      {
        name: 'GiwaPay Testnet Mock KRW',
        symbol: 'MockKRW',
        decimals: 6,
      },
      {
        name: 'GiwaPay Testnet Mock USDC',
        symbol: 'MockUSDC',
        decimals: 6,
      },
      {
        name: 'GiwaPay Testnet Mock ALT',
        symbol: 'MockALT',
        decimals: 18,
      },
    ]);

    const nonceResponse = await app.inject({
      method: 'POST',
      url: '/v1/auth/nonce',
      headers: { origin },
      payload: { address: merchantAccount.address },
    });
    expect(nonceResponse.statusCode).toBe(200);
    const nonce = nonceResponse.json<{
      nonce: string;
      domain: string;
      uri: string;
      chainId: number;
      issuedAt: string;
      expirationTime: string;
      statement: string;
    }>();
    const siweMessage = new SiweMessage({
      domain: nonce.domain,
      address: merchantAccount.address,
      statement: nonce.statement,
      uri: nonce.uri,
      version: '1',
      chainId: nonce.chainId,
      nonce: nonce.nonce,
      issuedAt: nonce.issuedAt,
      expirationTime: nonce.expirationTime,
    }).prepareMessage();
    const siweSignature = await merchantAccount.signMessage({
      message: siweMessage,
    });
    const sessionResponse = await app.inject({
      method: 'POST',
      url: '/v1/auth/verify',
      headers: { origin },
      payload: { message: siweMessage, signature: siweSignature },
    });
    expect(sessionResponse.statusCode).toBe(200);
    const session = sessionResponse.json<{ csrfToken: string }>();
    const sessionHeaders = {
      origin,
      cookie: cookieHeader(sessionResponse.headers['set-cookie']),
      'x-csrf-token': session.csrfToken,
    };

    const registerHash = await merchantWallet.writeContract({
      address: deployment.merchantRegistry,
      abi: merchantRegistryWriteAbi,
      functionName: 'registerMerchant',
      args: [
        merchantAccount.address,
        services.intentSigner.addressForMerchant(merchantAccount.address) as Address,
      ],
    });
    expect(
      (
        await publicClient.waitForTransactionReceipt({
          hash: registerHash,
        })
      ).status,
    ).toBe('success');
    await testClient.mine({ blocks: 1 });

    const registration = await app.inject({
      method: 'POST',
      url: '/v1/merchants/me/registration/verify',
      headers: sessionHeaders,
    });
    expect(registration.statusCode).toBe(200);
    expect(registration.json().merchant.status).toBe('active');

    const apiKeyIdempotency = crypto.randomUUID();
    const apiKeyResponse = await app.inject({
      method: 'POST',
      url: '/v1/api-keys',
      headers: {
        ...sessionHeaders,
        'idempotency-key': apiKeyIdempotency,
      },
      payload: {
        idempotencyKey: apiKeyIdempotency,
        name: 'anvil-integration',
        scopes: [
          'payment_intents:read',
          'payment_intents:write',
          'refunds:write',
          'webhooks:write',
        ],
      },
    });
    expect(apiKeyResponse.statusCode).toBe(201);
    const apiKey = apiKeyResponse.json<{ secret: string }>().secret;
    const authorization = `Bearer ${apiKey}`;

    const webhookEndpointResponse = await app.inject({
      method: 'POST',
      url: '/v1/webhook-endpoints',
      headers: { authorization },
      payload: {
        url: webhookUrl,
        description: 'Anvil integration receiver',
      },
    });
    expect(webhookEndpointResponse.statusCode).toBe(201);
    const webhookSecret = webhookEndpointResponse.json<{
      secret: string;
    }>().secret;

    const faucetHash = await customerWallet.writeContract({
      address: deployment.mockTokenFaucet,
      abi: faucetAbi,
      functionName: 'claim',
      args: [deployment.mockUSDC],
    });
    expect((await publicClient.waitForTransactionReceipt({ hash: faucetHash })).status).toBe(
      'success',
    );

    const methodsResponse = await app.inject({
      method: 'GET',
      url: `/v1/payment-methods?settlementToken=${deployment.mockKRW}`,
    });
    expect(methodsResponse.statusCode).toBe(200);
    const paymentMethods = methodsResponse.json<{
      data: Array<{
        token: { symbol: string };
        settlementToken: { symbol: string };
      }>;
    }>();
    expect(
      paymentMethods.data.some(
        (method) =>
          method.token.symbol === 'MockUSDC' && method.settlementToken.symbol === 'MockKRW',
      ),
    ).toBe(true);

    const intentIdempotency = crypto.randomUUID();
    const intentResponse = await app.inject({
      method: 'POST',
      url: '/v1/payment-intents',
      headers: {
        authorization,
        'idempotency-key': intentIdempotency,
      },
      payload: {
        idempotencyKey: intentIdempotency,
        description: 'Anvil exact-output integration payment',
        settlementToken: deployment.mockKRW,
        settlementAmount: '100000000',
        splitId: zeroHash,
        expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
      },
    });
    expect(intentResponse.statusCode).toBe(201);
    const created = intentResponse.json<PaymentIntentCreation>().paymentIntent;

    const quoteResponse = await app.inject({
      method: 'GET',
      url: `/v1/payment-intents/${created.id}/quote?tokenIn=${deployment.mockUSDC}&slippageBps=100`,
    });
    expect(quoteResponse.statusCode).toBe(200);
    const quote = quoteResponse.json<QuoteResponse>();
    expect(quote.adapter).toBe(deployment.mockExactOutputAdapter.toLowerCase());
    expect(quote.adapter).not.toBe(zeroAddress);
    expect(quote.adapterIdentifier).toBe('mock-fixed-rate-v1');
    expect(quote.exactMerchantAmount).toBe('100000000');
    expect(quote.platformFee).toBe('500000');

    const preparationResponse = await app.inject({
      method: 'POST',
      url: `/v1/payment-intents/${created.id}/prepare`,
      payload: {
        tokenIn: deployment.mockUSDC,
        quoteId: quote.quoteId,
        slippageBps: 100,
      },
    });
    expect(preparationResponse.statusCode).toBe(200);
    const preparation = preparationResponse.json<PreparationResponse>();
    expect(preparation.approval.required).toBe(true);
    expect(preparation.approval.spender).toBe(deployment.paymentRouter.toLowerCase());

    const merchantSettlementBefore = await publicClient.readContract({
      address: deployment.mockKRW,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [merchantAccount.address],
    });
    const customerInputBefore = await publicClient.readContract({
      address: deployment.mockUSDC,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [customerAccount.address],
    });
    const approvalHash = await customerWallet.sendTransaction({
      to: preparation.approval.transaction.to,
      data: preparation.approval.transaction.data,
      value: BigInt(preparation.approval.transaction.value),
    });
    expect(
      (
        await publicClient.waitForTransactionReceipt({
          hash: approvalHash,
        })
      ).status,
    ).toBe('success');
    const paymentHash = await customerWallet.sendTransaction({
      to: preparation.payment.transaction.to,
      data: preparation.payment.transaction.data,
      value: BigInt(preparation.payment.transaction.value),
    });
    expect(
      (
        await publicClient.waitForTransactionReceipt({
          hash: paymentHash,
        })
      ).status,
    ).toBe('success');
    const merchantSettlementAfter = await publicClient.readContract({
      address: deployment.mockKRW,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [merchantAccount.address],
    });
    const customerInputAfter = await publicClient.readContract({
      address: deployment.mockUSDC,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [customerAccount.address],
    });
    expect(merchantSettlementAfter - merchantSettlementBefore).toBe(100_000_000n);
    expect(customerInputBefore - customerInputAfter).toBe(BigInt(quote.estimatedInputAmount));

    await testClient.mine({ blocks: 1 });
    const indexer = new ChainIndexer(services, pino({ level: 'silent' }));
    await expect(indexer.next()).resolves.toBe(true);
    const [storedPayment] = await database.db
      .select()
      .from(paymentIntents)
      .where(eq(paymentIntents.id, created.id))
      .limit(1);
    expect(storedPayment).toMatchObject({
      status: 'succeeded',
      paymentTransactionHash: paymentHash,
      inputToken: deployment.mockUSDC.toLowerCase(),
      inputAmount: quote.estimatedInputAmount,
      refundedAmount: '0',
    });
    expect(storedPayment?.settlementRecipients).toEqual([
      {
        address: merchantAccount.address.toLowerCase(),
        basisPoints: 10_000,
        amount: '100000000',
      },
    ]);

    const paymentDeliveries = await claimWebhookDeliveries(services);
    expect(paymentDeliveries).toHaveLength(1);
    expect(paymentDeliveries[0]?.event.eventType).toBe('payment.succeeded');
    await deliverWebhook(services, paymentDeliveries[0]!, pino({ level: 'silent' }));
    expect(receivedWebhooks).toHaveLength(1);
    const paymentWebhook = assertSignedWebhook(
      receivedWebhooks[0]!,
      webhookSecret,
      'payment.succeeded',
    );
    expect(paymentWebhook.data.settlementRecipients).toEqual(storedPayment?.settlementRecipients);

    const refundIdempotency = crypto.randomUUID();
    const refundResponse = await app.inject({
      method: 'POST',
      url: `/v1/payment-intents/${created.id}/refunds`,
      headers: {
        authorization,
        'idempotency-key': refundIdempotency,
      },
      payload: {
        amount: '40000000',
        reason: 'Anvil integration partial refund',
        idempotencyKey: refundIdempotency,
      },
    });
    expect(refundResponse.statusCode).toBe(201);
    const refund = refundResponse.json<RefundPreparation>();
    expect(refund.refund.status).toBe('requested');
    expect(refund.refund.amount).toBe('40000000');

    const customerRefundBefore = await publicClient.readContract({
      address: deployment.mockKRW,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [customerAccount.address],
    });
    const merchantRefundFundingBefore = await publicClient.readContract({
      address: deployment.mockKRW,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [merchantAccount.address],
    });
    const refundApprovalHash = await merchantWallet.sendTransaction({
      to: refund.approval.to,
      data: refund.approval.data,
      value: BigInt(refund.approval.value),
    });
    expect(
      (
        await publicClient.waitForTransactionReceipt({
          hash: refundApprovalHash,
        })
      ).status,
    ).toBe('success');
    const refundHash = await merchantWallet.sendTransaction({
      to: refund.transaction.to,
      data: refund.transaction.data,
      value: BigInt(refund.transaction.value),
    });
    expect(
      (
        await publicClient.waitForTransactionReceipt({
          hash: refundHash,
        })
      ).status,
    ).toBe('success');
    const customerRefundAfter = await publicClient.readContract({
      address: deployment.mockKRW,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [customerAccount.address],
    });
    const merchantRefundFundingAfter = await publicClient.readContract({
      address: deployment.mockKRW,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [merchantAccount.address],
    });
    expect(customerRefundAfter - customerRefundBefore).toBe(40_000_000n);
    expect(merchantRefundFundingBefore - merchantRefundFundingAfter).toBe(40_000_000n);

    await testClient.mine({ blocks: 1 });
    await expect(indexer.next()).resolves.toBe(true);
    const [storedRefund] = await database.db
      .select()
      .from(refundRequests)
      .where(eq(refundRequests.refundId, refund.refund.refundId))
      .limit(1);
    expect(storedRefund).toMatchObject({
      status: 'succeeded',
      amount: '40000000',
      transactionHash: refundHash,
    });
    const [partiallyRefundedPayment] = await database.db
      .select()
      .from(paymentIntents)
      .where(eq(paymentIntents.id, created.id))
      .limit(1);
    expect(partiallyRefundedPayment).toMatchObject({
      status: 'partially_refunded',
      refundedAmount: '40000000',
    });
    expect(partiallyRefundedPayment?.settlementRecipients).toEqual(
      storedPayment?.settlementRecipients,
    );

    const refundDeliveries = await claimWebhookDeliveries(services);
    expect(refundDeliveries).toHaveLength(1);
    expect(refundDeliveries[0]?.event.eventType).toBe('refund.succeeded');
    await deliverWebhook(services, refundDeliveries[0]!, pino({ level: 'silent' }));
    expect(receivedWebhooks).toHaveLength(2);
    const refundWebhook = assertSignedWebhook(
      receivedWebhooks[1]!,
      webhookSecret,
      'refund.succeeded',
    );
    expect(refundWebhook.data).toMatchObject({
      paymentIntentId: created.id,
      amount: '40000000',
      totalRefunded: '40000000',
      transactionHash: refundHash,
    });

    const allDeliveries = await database.db
      .select({
        status: webhookDeliveries.status,
        eventType: webhookEvents.eventType,
      })
      .from(webhookDeliveries)
      .innerJoin(webhookEvents, eq(webhookEvents.id, webhookDeliveries.eventId));
    expect(allDeliveries).toHaveLength(2);
    expect(allDeliveries).toEqual(
      expect.arrayContaining([
        { status: 'succeeded', eventType: 'payment.succeeded' },
        { status: 'succeeded', eventType: 'refund.succeeded' },
      ]),
    );

    const publicReceipt = await app.inject({
      method: 'GET',
      url: `/v1/payment-intents/${created.id}`,
    });
    expect(publicReceipt.statusCode).toBe(200);
    expect(publicReceipt.json()).toMatchObject({
      paymentIntent: {
        status: 'partially_refunded',
        settlementRecipients: storedPayment?.settlementRecipients,
        refundedAmount: '40000000',
      },
      refunds: [
        {
          refundId: refund.refund.refundId,
          status: 'succeeded',
          amount: '40000000',
        },
      ],
    });
  }, 120_000);
});
