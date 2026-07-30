import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { promisify } from 'node:util';

import { expect, test, type Page } from '@playwright/test';
import { getAddress, type Address, type Hex } from 'viem';

import {
  assertAnvilWalletBridgeRejectsUnauthorizedCall,
  installAnvilEip1193Wallet,
  readAnvilWalletTransactions,
} from './anvil-eip1193';

const execFileAsync = promisify(execFile);
const repositoryRoot = resolve(process.cwd(), '../..');
const expectedStateKeys = [
  'approvalCalldata',
  'apiBaseUrl',
  'chainId',
  'intentId',
  'mockKrw',
  'payerAddress',
  'paymentCalldata',
  'paymentRouter',
  'rpcUrl',
  'version',
  'webBaseUrl',
] as const;
const addressPattern = /^0x[0-9a-fA-F]{40}$/;
const hashPattern = /^0x[0-9a-fA-F]{64}$/;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface WalletE2eState {
  version: 1;
  chainId: 91342;
  rpcUrl: 'http://127.0.0.1:8545';
  apiBaseUrl: 'http://127.0.0.1:3001';
  webBaseUrl: 'http://127.0.0.1:3000';
  intentId: string;
  payerAddress: Address;
  mockKrw: Address;
  paymentRouter: Address;
  approvalCalldata: Hex;
  paymentCalldata: Hex;
}

interface PublicPaymentRecord {
  payer: Address | null;
  transactionHash: Hex;
  verifiedAt: string | null;
}

interface PublicPaymentIntentDetail {
  paymentIntent: {
    id: string;
    status: string;
    merchant?: {
      name: string;
      payoutAddress: Address;
    };
    description: string;
    settlement: {
      token: Address;
      amount: string;
    };
    chainId: number;
    routerAddress: Address;
    payment: PublicPaymentRecord | null;
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function invalidState(message: string): never {
  throw new Error(`Invalid public wallet E2E state: ${message}`);
}

function readString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== 'string') invalidState(`${key} must be a string`);
  return value;
}

function readAddress(record: Record<string, unknown>, key: string): Address {
  const value = readString(record, key);
  if (!addressPattern.test(value) || /^0x0{40}$/i.test(value)) {
    invalidState(`${key} must be a non-zero EVM address`);
  }
  return value as Address;
}

function readCalldata(record: Record<string, unknown>, key: string): Hex {
  const value = readString(record, key);
  if (!/^0x(?:[0-9a-fA-F]{2})+$/.test(value)) {
    invalidState(`${key} must be non-empty canonical hex calldata`);
  }
  return value.toLowerCase() as Hex;
}

function readLoopbackUrl(
  record: Record<string, unknown>,
  key: string,
  port: 3000 | 3001 | 8545,
): string {
  const value = readString(record, key);
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return invalidState(`${key} must be a URL`);
  }
  if (
    value !== `http://127.0.0.1:${port}` ||
    parsed.protocol !== 'http:' ||
    parsed.hostname !== '127.0.0.1' ||
    parsed.port !== String(port) ||
    parsed.pathname !== '/' ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash
  ) {
    invalidState(`${key} must be the dedicated loopback port ${port}`);
  }
  return value;
}

async function loadWalletE2eState(): Promise<WalletE2eState> {
  const statePath = process.env.GIWAPAY_WALLET_E2E_STATE;
  if (!statePath) invalidState('GIWAPAY_WALLET_E2E_STATE is required');

  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(statePath, 'utf8')) as unknown;
  } catch {
    return invalidState('state file must exist and contain valid JSON');
  }
  if (!isRecord(parsed)) invalidState('top-level value must be an object');

  const actualKeys = Object.keys(parsed).sort();
  if (JSON.stringify(actualKeys) !== JSON.stringify([...expectedStateKeys].sort())) {
    invalidState('state file must contain only the documented public fields');
  }
  if (parsed.version !== 1) invalidState('version must be 1');
  if (parsed.chainId !== 91342) invalidState('chainId must be 91342');

  const intentId = readString(parsed, 'intentId');
  if (!uuidPattern.test(intentId)) invalidState('intentId must be a UUID');

  const payerAddress = readAddress(parsed, 'payerAddress');
  const mockKrw = readAddress(parsed, 'mockKrw');
  const paymentRouter = readAddress(parsed, 'paymentRouter');
  if (
    new Set([payerAddress, mockKrw, paymentRouter].map((value) => value.toLowerCase())).size !== 3
  ) {
    invalidState('payer, token, and router addresses must be distinct');
  }

  return {
    version: 1,
    chainId: 91342,
    rpcUrl: readLoopbackUrl(parsed, 'rpcUrl', 8545) as WalletE2eState['rpcUrl'],
    apiBaseUrl: readLoopbackUrl(parsed, 'apiBaseUrl', 3001) as WalletE2eState['apiBaseUrl'],
    webBaseUrl: readLoopbackUrl(parsed, 'webBaseUrl', 3000) as WalletE2eState['webBaseUrl'],
    intentId,
    payerAddress,
    mockKrw,
    paymentRouter,
    approvalCalldata: readCalldata(parsed, 'approvalCalldata'),
    paymentCalldata: readCalldata(parsed, 'paymentCalldata'),
  };
}

async function rpcRequest<T>(
  rpcUrl: WalletE2eState['rpcUrl'],
  method: string,
  params: readonly unknown[] = [],
): Promise<T> {
  const response = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`Local Anvil RPC returned HTTP ${response.status}`);

  const payload = (await response.json()) as {
    result?: T;
    error?: { message?: string };
  };
  if (payload.error || !Object.hasOwn(payload, 'result')) {
    throw new Error(`Local Anvil RPC rejected ${method}`);
  }
  return payload.result as T;
}

async function readPublicIntent(state: WalletE2eState): Promise<PublicPaymentIntentDetail> {
  const response = await fetch(
    `${state.apiBaseUrl}/v1/payment-intents/${encodeURIComponent(state.intentId)}`,
    {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(10_000),
    },
  );
  if (!response.ok) throw new Error(`Public payment API returned HTTP ${response.status}`);

  const payload = (await response.json()) as unknown;
  if (!isRecord(payload) || !isRecord(payload.paymentIntent)) {
    throw new Error('Public payment API returned an invalid PaymentIntent detail');
  }
  return payload as unknown as PublicPaymentIntentDetail;
}

async function stopIndexer(): Promise<void> {
  await execFileAsync(
    'docker',
    [
      'compose',
      '--env-file',
      resolve(repositoryRoot, '.env.demo'),
      '-f',
      resolve(repositoryRoot, 'docker-compose.yml'),
      'stop',
      '--timeout',
      '10',
      'indexer',
    ],
    { cwd: repositoryRoot, timeout: 30_000 },
  );
}

async function startIndexer(): Promise<void> {
  await execFileAsync(
    'docker',
    [
      'compose',
      '--env-file',
      resolve(repositoryRoot, '.env.demo'),
      '-f',
      resolve(repositoryRoot, 'docker-compose.yml'),
      'start',
      'indexer',
    ],
    { cwd: repositoryRoot, timeout: 30_000 },
  );
}

function sameAddress(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

function shortHash(hash: Hex): string {
  return `${hash.slice(0, 6)}…${hash.slice(-4)}`;
}

async function paceVideo(page: Page, milliseconds = 550): Promise<void> {
  await page.waitForTimeout(milliseconds);
}

test('records one real local wallet payment through canonical indexer verification', async ({
  page,
}) => {
  const state = await loadWalletE2eState();
  const chainIdHex = await rpcRequest<string>(state.rpcUrl, 'eth_chainId');
  expect(Number(BigInt(chainIdHex))).toBe(state.chainId);

  const accounts = await rpcRequest<readonly Address[]>(state.rpcUrl, 'eth_accounts');
  expect(accounts[1]?.toLowerCase()).toBe(state.payerAddress.toLowerCase());
  for (const contractAddress of [state.mockKrw, state.paymentRouter]) {
    const code = await rpcRequest<string>(state.rpcUrl, 'eth_getCode', [contractAddress, 'latest']);
    expect(code).toMatch(/^0x[0-9a-f]+$/i);
    expect(code).not.toBe('0x');
  }

  const initial = await readPublicIntent(state);
  expect(initial.paymentIntent).toMatchObject({
    id: state.intentId,
    status: 'created',
    merchant: { name: 'GASOK Demo Merchant' },
    description: 'GASOK verified local payment',
    settlement: { amount: '100000000' },
    chainId: state.chainId,
    payment: null,
  });
  expect(sameAddress(initial.paymentIntent.settlement.token, state.mockKrw)).toBe(true);
  expect(sameAddress(initial.paymentIntent.routerAddress, state.paymentRouter)).toBe(true);

  await installAnvilEip1193Wallet(page, {
    accountIndex: 1,
    allowedTransactionTargets: [state.mockKrw, state.paymentRouter],
    expectedApprovalData: state.approvalCalldata,
    expectedPaymentData: state.paymentCalldata,
  });
  await page.addInitScript(() => {
    window.localStorage.setItem('giwapay.locale', 'en');
  });

  const navigation = await page.goto(
    `${state.webBaseUrl}/checkout/${encodeURIComponent(state.intentId)}`,
  );
  expect(navigation?.ok()).toBe(true);
  await assertAnvilWalletBridgeRejectsUnauthorizedCall(page);

  await expect(page.getByText('GASOK Demo Merchant', { exact: true })).toBeVisible();
  await expect(page.getByText('GASOK verified local payment', { exact: true })).toBeVisible();
  await expect(page.getByText('Merchant-signed PaymentIntent', { exact: true })).toBeVisible();
  await expect(
    page.getByText('Testnet demo · Mock tokens have no monetary value.', { exact: true }),
  ).toBeVisible();
  await expect(page.getByText('100 MockKRW', { exact: true })).toBeVisible();

  const maximumInput = page
    .locator('.checkout-key-terms > div')
    .filter({ has: page.locator('dt', { hasText: 'Maximum input' }) });
  await expect(maximumInput.locator('dd')).toHaveText('101.505 MockKRW');
  await paceVideo(page);

  await page.getByRole('button', { name: 'Connect wallet', exact: true }).click();
  await page.getByRole('button', { name: 'GiwaPay Anvil test wallet', exact: true }).click();
  const authorizedAccounts = await page.evaluate(async () => {
    const provider = Reflect.get(window, 'ethereum') as
      { request: (request: { method: string }) => Promise<unknown> } | undefined;
    return provider?.request({ method: 'eth_accounts' });
  });
  expect(authorizedAccounts).toEqual([state.payerAddress.toLowerCase()]);
  await expect(page.getByRole('button', { name: 'Approve & pay' })).toBeEnabled();
  await paceVideo(page);

  let paymentHash: Hex | undefined;
  try {
    await stopIndexer();
    await page.getByRole('button', { name: 'Approve & pay' }).click();

    await expect(page.getByRole('button', { name: 'Verifying chain event…' })).toBeVisible({
      timeout: 60_000,
    });
    const pendingBanner = page.getByRole('status').filter({
      hasText:
        'Transaction submitted, but payment is not yet marked successful. Waiting for the independent indexer.',
    });
    await expect(pendingBanner).toBeVisible();

    const unverified = await readPublicIntent(state);
    expect(unverified.paymentIntent.status).toBe('created');
    expect(unverified.paymentIntent.payment).toBeNull();

    const walletTransactions = await readAnvilWalletTransactions(page);
    expect(walletTransactions).toHaveLength(2);
    expect(sameAddress(walletTransactions[0]!.to, state.mockKrw)).toBe(true);
    expect(sameAddress(walletTransactions[1]!.to, state.paymentRouter)).toBe(true);
    expect(walletTransactions.every(({ hash }) => hashPattern.test(hash))).toBe(true);
    expect(new Set(walletTransactions.map(({ hash }) => hash)).size).toBe(2);
    const routerTransactions = walletTransactions.filter(({ to }) =>
      sameAddress(to, state.paymentRouter),
    );
    expect(routerTransactions).toHaveLength(1);
    const capturedPaymentHash = routerTransactions[0]?.hash;
    if (!capturedPaymentHash) {
      throw new Error('Wallet did not record a PaymentRouter transaction hash');
    }
    paymentHash = capturedPaymentHash;
    expect(paymentHash).toMatch(hashPattern);
    await expect(pendingBanner).toContainText(`Local Anvil transaction ${shortHash(paymentHash)}`);
    await paceVideo(page, 850);
  } finally {
    await startIndexer();
  }

  if (!paymentHash) throw new Error('Wallet did not record a PaymentRouter transaction hash');

  await expect
    .poll(
      async () => {
        const detail = await readPublicIntent(state);
        return detail.paymentIntent.status;
      },
      {
        message: 'canonical PaymentSucceeded event should be indexed',
        timeout: 90_000,
        intervals: [1_000, 1_000, 2_000],
      },
    )
    .toBe('succeeded');

  const verified = await readPublicIntent(state);
  expect(verified.paymentIntent.payment).not.toBeNull();
  expect(verified.paymentIntent.payment?.transactionHash.toLowerCase()).toBe(
    paymentHash.toLowerCase(),
  );
  expect(verified.paymentIntent.payment?.payer?.toLowerCase()).toBe(
    state.payerAddress.toLowerCase(),
  );
  expect(verified.paymentIntent.payment?.verifiedAt).not.toBeNull();

  const receiptLink = page.getByRole('link', { name: 'View verified receipt' });
  await expect(receiptLink).toBeVisible({ timeout: 30_000 });
  await receiptLink.click();
  await expect(page).toHaveURL(`${state.webBaseUrl}/receipt/${encodeURIComponent(state.intentId)}`);

  await expect(page.getByRole('heading', { name: 'Payment verified' })).toBeVisible();
  await expect(page.getByText('Paid', { exact: true })).toBeVisible();
  const settlement = page
    .locator('.gp-definition-row')
    .filter({ has: page.locator('dt', { hasText: 'Exact settlement' }) });
  await expect(settlement.locator('dd')).toHaveText('100 MockKRW');

  await page.getByText('Receipt details and verification', { exact: true }).click();
  const payer = page
    .locator('.gp-definition-row')
    .filter({ has: page.locator('dt', { hasText: 'Paid from' }) });
  await expect(payer.locator('dd')).toHaveText(getAddress(state.payerAddress));
  await paceVideo(page, 1_000);
});
