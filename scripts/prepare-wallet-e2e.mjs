import { Buffer } from 'node:buffer';
import { randomUUID } from 'node:crypto';
import { chmod, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import process from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath, URL } from 'node:url';

const repositoryRoot = fileURLToPath(new URL('..', import.meta.url));
const requireFromWeb = createRequire(resolve(repositoryRoot, 'apps/web/package.json'));
const requireFromApi = createRequire(resolve(repositoryRoot, 'apps/api/package.json'));
const { encodeFunctionData, getAddress, parseAbi } = requireFromWeb('viem');
const { SiweMessage } = requireFromApi('siwe');

const chainId = 91_342;
const rpcUrl = 'http://127.0.0.1:8545';
const apiBaseUrl = 'http://127.0.0.1:3001';
const webBaseUrl = 'http://127.0.0.1:3000';
const manifestPath = resolve(repositoryRoot, 'deployments/local/current.json');
const addressPattern = /^0x[0-9a-fA-F]{40}$/;
const transactionHashPattern = /^0x[0-9a-fA-F]{64}$/;
const calldataPattern = /^0x(?:[0-9a-fA-F]{2})+$/;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const registerMerchantAbi = parseAbi([
  'function registerMerchant(address payoutAddress,address delegatedSigner)',
]);
const faucetAbi = parseAbi(['function claim(address token)']);

class FixtureError extends Error {}

function fail(message) {
  throw new FixtureError(message);
}

function loopbackBaseUrl(value, label) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    fail(`${label} must be a valid URL`);
  }
  const hostname = parsed.hostname.toLowerCase();
  if (
    parsed.protocol !== 'http:' ||
    !['127.0.0.1', 'localhost', '[::1]', '::1'].includes(hostname) ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash ||
    (parsed.pathname !== '/' && parsed.pathname !== '')
  ) {
    fail(`${label} must be an uncredentialed loopback HTTP origin`);
  }
  return parsed.origin;
}

function checkedAddress(value, label) {
  if (typeof value !== 'string' || !addressPattern.test(value)) {
    fail(`Local deployment is missing ${label}`);
  }
  try {
    const address = getAddress(value);
    if (address.toLowerCase() === '0x0000000000000000000000000000000000000000') {
      fail(`Local deployment contains a zero ${label}`);
    }
    return address;
  } catch {
    fail(`Local deployment contains an invalid ${label}`);
  }
}

let rpcRequestId = 0;

async function rpc(method, params = []) {
  let response;
  try {
    response = await globalThis.fetch(rpcUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: ++rpcRequestId,
        method,
        params,
      }),
      signal: globalThis.AbortSignal.timeout(15_000),
    });
  } catch {
    fail(`Local JSON-RPC request failed: ${method}`);
  }
  if (!response.ok) {
    fail(`Local JSON-RPC returned HTTP ${response.status}: ${method}`);
  }
  let payload;
  try {
    payload = await response.json();
  } catch {
    fail(`Local JSON-RPC returned invalid JSON: ${method}`);
  }
  if (
    !payload ||
    typeof payload !== 'object' ||
    Object.hasOwn(payload, 'error') ||
    !Object.hasOwn(payload, 'result')
  ) {
    fail(`Local JSON-RPC rejected: ${method}`);
  }
  return payload.result;
}

async function apiJson(path, { method = 'GET', headers = {}, body, expectedStatus = 200 } = {}) {
  let response;
  try {
    response = await globalThis.fetch(`${apiBaseUrl}${path}`, {
      method,
      headers: {
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...headers,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: globalThis.AbortSignal.timeout(20_000),
    });
  } catch {
    fail(`Local API request failed: ${method} ${path}`);
  }
  if (response.status !== expectedStatus) {
    fail(`Local API returned HTTP ${response.status}: ${method} ${path}`);
  }
  let data;
  try {
    data = await response.json();
  } catch {
    fail(`Local API returned invalid JSON: ${method} ${path}`);
  }
  return { data, headers: response.headers };
}

function cookieHeader(headers) {
  const setCookies =
    typeof headers.getSetCookie === 'function'
      ? headers.getSetCookie()
      : (headers.get('set-cookie') ?? '').split(/,(?=\s*giwapay_)/);
  const cookies = setCookies
    .map((value) => value.split(';', 1)[0]?.trim())
    .filter((value) => value?.startsWith('giwapay_'));
  if (
    !cookies.some((value) => value.startsWith('giwapay_session=')) ||
    !cookies.some((value) => value.startsWith('giwapay_csrf='))
  ) {
    fail('Local API did not issue the required session cookies');
  }
  return cookies.join('; ');
}

async function waitForReceipt(hash, label) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const receipt = await rpc('eth_getTransactionReceipt', [hash]);
    if (receipt) {
      if (receipt.status !== '0x1') {
        fail(`${label} transaction reverted`);
      }
      return receipt;
    }
    await delay(250);
  }
  fail(`${label} transaction receipt timed out`);
}

async function sendTransaction(from, to, data, label) {
  const hash = await rpc('eth_sendTransaction', [
    {
      from,
      to,
      data,
      value: '0x0',
    },
  ]);
  if (typeof hash !== 'string' || !transactionHashPattern.test(hash)) {
    fail(`${label} returned an invalid transaction hash`);
  }
  return waitForReceipt(hash, label);
}

async function mineConfirmedHead(receipt, confirmations) {
  if (typeof receipt.blockNumber !== 'string' || !/^0x[0-9a-fA-F]+$/.test(receipt.blockNumber)) {
    fail('Merchant registration receipt is missing a block number');
  }
  const requiredHead = BigInt(receipt.blockNumber) + BigInt(confirmations);
  for (;;) {
    const current = await rpc('eth_blockNumber');
    if (typeof current !== 'string' || !/^0x[0-9a-fA-F]+$/.test(current)) {
      fail('Local chain returned an invalid block number');
    }
    if (BigInt(current) >= requiredHead) return;
    await rpc('evm_mine');
  }
}

async function assertContract(address, label) {
  const code = await rpc('eth_getCode', [address, 'latest']);
  if (typeof code !== 'string' || !/^0x[0-9a-fA-F]+$/.test(code) || code === '0x') {
    fail(`${label} has no code on the local chain`);
  }
}

async function writePublicState(outputPath, state) {
  const temporaryPath = `${outputPath}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o600,
    });
    await chmod(temporaryPath, 0o600);
    await rename(temporaryPath, outputPath);
    await chmod(outputPath, 0o600);
  } finally {
    await rm(temporaryPath, { force: true });
  }
}

async function main() {
  const [outputArgument, ...extraArguments] = process.argv.slice(2);
  if (!outputArgument || extraArguments.length > 0) {
    fail('Usage: node scripts/prepare-wallet-e2e.mjs <public-state-file>');
  }
  const outputPath = resolve(outputArgument);

  loopbackBaseUrl(rpcUrl, 'RPC URL');
  loopbackBaseUrl(apiBaseUrl, 'API base URL');
  loopbackBaseUrl(webBaseUrl, 'Web base URL');

  let manifest;
  try {
    manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  } catch {
    fail('Could not read the local deployment manifest');
  }
  if (manifest?.chainId !== chainId || manifest?.mode !== 'local-anvil') {
    fail('Expected a local-anvil deployment manifest for chain 91342');
  }

  const merchantRegistry = checkedAddress(manifest.contracts?.merchantRegistry, 'MerchantRegistry');
  const paymentRouter = checkedAddress(manifest.contracts?.paymentRouter, 'PaymentRouter');
  const mockKrw = checkedAddress(manifest.contracts?.mockKRW, 'MockKRW');
  const mockTokenFaucet = checkedAddress(manifest.contracts?.mockTokenFaucet, 'MockTokenFaucet');

  const reportedChainId = await rpc('eth_chainId');
  if (
    typeof reportedChainId !== 'string' ||
    !/^0x[0-9a-fA-F]+$/.test(reportedChainId) ||
    BigInt(reportedChainId) !== BigInt(chainId)
  ) {
    fail('Local JSON-RPC is not GIWA chain 91342');
  }
  await Promise.all([
    assertContract(merchantRegistry, 'MerchantRegistry'),
    assertContract(paymentRouter, 'PaymentRouter'),
    assertContract(mockKrw, 'MockKRW'),
    assertContract(mockTokenFaucet, 'MockTokenFaucet'),
  ]);

  const accounts = await rpc('eth_accounts');
  if (!Array.isArray(accounts) || accounts.length < 2) {
    fail('Local Anvil must expose at least two unlocked accounts');
  }
  const merchantAddress = checkedAddress(accounts[0], 'Anvil merchant account');
  const payerAddress = checkedAddress(accounts[1], 'Anvil payer account');
  if (merchantAddress === payerAddress) {
    fail('Local Anvil merchant and payer accounts must be distinct');
  }

  const ready = await apiJson('/ready');
  if (ready.data?.status !== 'ready') {
    fail('Local API is not ready');
  }
  let webResponse;
  try {
    webResponse = await globalThis.fetch(webBaseUrl, {
      signal: globalThis.AbortSignal.timeout(20_000),
    });
  } catch {
    fail('Local web app request failed');
  }
  if (!webResponse.ok || new URL(webResponse.url).origin !== webBaseUrl) {
    fail('Local web app is not available on the expected loopback origin');
  }

  const nonceResponse = await apiJson('/v1/auth/nonce', {
    method: 'POST',
    headers: { origin: webBaseUrl },
    body: { address: merchantAddress },
  });
  const nonce = nonceResponse.data;
  if (
    typeof nonce?.nonce !== 'string' ||
    nonce.chainId !== chainId ||
    nonce.domain !== new URL(webBaseUrl).host ||
    nonce.uri !== webBaseUrl
  ) {
    fail('Local API returned invalid SIWE nonce context');
  }
  const siweMessage = new SiweMessage({
    domain: nonce.domain,
    address: merchantAddress,
    statement: nonce.statement,
    uri: nonce.uri,
    version: '1',
    chainId: nonce.chainId,
    nonce: nonce.nonce,
    issuedAt: nonce.issuedAt,
    expirationTime: nonce.expirationTime,
  }).prepareMessage();
  const signature = await rpc('personal_sign', [
    `0x${Buffer.from(siweMessage, 'utf8').toString('hex')}`,
    merchantAddress,
  ]);
  if (typeof signature !== 'string' || !/^0x[0-9a-fA-F]{130}$/.test(signature)) {
    fail('Local Anvil returned an invalid SIWE signature');
  }

  const sessionResponse = await apiJson('/v1/auth/verify', {
    method: 'POST',
    headers: { origin: webBaseUrl },
    body: { message: siweMessage, signature },
  });
  const csrfToken = sessionResponse.data?.csrfToken;
  if (typeof csrfToken !== 'string' || csrfToken.length < 16) {
    fail('Local API did not issue a CSRF token');
  }
  const sessionCookie = cookieHeader(sessionResponse.headers);
  const sessionHeaders = {
    origin: webBaseUrl,
    cookie: sessionCookie,
    'x-csrf-token': csrfToken,
  };

  const merchantContext = await apiJson('/v1/merchants/me', {
    headers: { cookie: sessionCookie },
  });
  if (
    merchantContext.data?.merchant?.onchainMerchantAddress?.toLowerCase() !==
    merchantAddress.toLowerCase()
  ) {
    fail('Authenticated merchant identity does not match Anvil account 0');
  }
  const delegatedSigner = checkedAddress(
    merchantContext.data?.requiredDelegatedSignerAddress,
    'delegated PaymentIntent signer',
  );
  if (
    delegatedSigner.toLowerCase() === merchantAddress.toLowerCase() ||
    delegatedSigner.toLowerCase() === merchantContext.data.merchant.payoutAddress?.toLowerCase()
  ) {
    fail('Merchant signer does not satisfy on-chain role separation');
  }

  await apiJson('/v1/merchants/me', {
    method: 'PATCH',
    headers: sessionHeaders,
    body: { displayName: 'GASOK Demo Merchant' },
  });

  const registrationData = encodeFunctionData({
    abi: registerMerchantAbi,
    functionName: 'registerMerchant',
    args: [merchantAddress, delegatedSigner],
  });
  const registrationReceipt = await sendTransaction(
    merchantAddress,
    merchantRegistry,
    registrationData,
    'MerchantRegistry registration',
  );
  await mineConfirmedHead(registrationReceipt, 3);

  const verifiedRegistration = await apiJson('/v1/merchants/me/registration/verify', {
    method: 'POST',
    headers: sessionHeaders,
  });
  if (
    verifiedRegistration.data?.merchant?.status !== 'active' ||
    verifiedRegistration.data.merchant.displayName !== 'GASOK Demo Merchant' ||
    verifiedRegistration.data.merchant.delegatedSignerAddress?.toLowerCase() !==
      delegatedSigner.toLowerCase()
  ) {
    fail('API did not independently verify the MerchantRegistry registration');
  }

  const faucetData = encodeFunctionData({
    abi: faucetAbi,
    functionName: 'claim',
    args: [mockKrw],
  });
  await sendTransaction(payerAddress, mockTokenFaucet, faucetData, 'MockKRW faucet claim');

  const idempotencyKey = randomUUID();
  const created = await apiJson('/v1/payment-intents', {
    method: 'POST',
    headers: {
      ...sessionHeaders,
      'idempotency-key': idempotencyKey,
    },
    body: {
      idempotencyKey,
      description: 'GASOK verified local payment',
      settlementToken: mockKrw,
      settlementAmount: '100000000',
      expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
      payer: payerAddress,
      metadata: {
        environment: 'local-anvil',
        evidence: 'wallet-e2e-video',
      },
    },
    expectedStatus: 201,
  });
  const intent = created.data?.paymentIntent;
  if (
    typeof intent?.id !== 'string' ||
    !uuidPattern.test(intent.id) ||
    intent.status !== 'created' ||
    intent.description !== 'GASOK verified local payment' ||
    intent.chainId !== chainId ||
    intent.settlement?.token?.toLowerCase() !== mockKrw.toLowerCase() ||
    intent.settlement?.amount !== '100000000' ||
    intent.payerRestriction?.toLowerCase() !== payerAddress.toLowerCase() ||
    intent.routerAddress?.toLowerCase() !== paymentRouter.toLowerCase()
  ) {
    fail('Local API returned an inconsistent PaymentIntent');
  }

  const quoteResponse = await apiJson(
    `/v1/payment-intents/${encodeURIComponent(intent.id)}/quote?tokenIn=${encodeURIComponent(mockKrw)}&slippageBps=100`,
  );
  const quote = quoteResponse.data;
  if (
    typeof quote?.quoteId !== 'string' ||
    quote.quoteId.length < 32 ||
    quote.tokenIn?.toLowerCase() !== mockKrw.toLowerCase() ||
    quote.settlementToken?.toLowerCase() !== mockKrw.toLowerCase() ||
    quote.exactMerchantAmount !== '100000000' ||
    quote.platformFee !== '500000' ||
    quote.estimatedInputAmount !== '100500000' ||
    quote.maximumInputAmount !== '101505000' ||
    quote.slippageBps !== 100 ||
    quote.router?.toLowerCase() !== paymentRouter.toLowerCase() ||
    quote.approvalSpender?.toLowerCase() !== paymentRouter.toLowerCase()
  ) {
    fail('Local API returned inconsistent GASOK evidence quote terms');
  }

  const prepareResponse = await apiJson(
    `/v1/payment-intents/${encodeURIComponent(intent.id)}/prepare`,
    {
      method: 'POST',
      body: {
        tokenIn: mockKrw,
        quoteId: quote.quoteId,
        slippageBps: 100,
      },
    },
  );
  const prepared = prepareResponse.data;
  const approvalCalldata = prepared?.approval?.transaction?.data;
  const paymentCalldata = prepared?.payment?.transaction?.data;
  if (
    prepared?.approval?.required !== true ||
    prepared.approval.token?.toLowerCase() !== mockKrw.toLowerCase() ||
    prepared.approval.spender?.toLowerCase() !== paymentRouter.toLowerCase() ||
    prepared.approval.amount !== quote.maximumInputAmount ||
    prepared.approval.transaction?.to?.toLowerCase() !== mockKrw.toLowerCase() ||
    prepared.approval.transaction?.value !== '0' ||
    typeof approvalCalldata !== 'string' ||
    !calldataPattern.test(approvalCalldata) ||
    prepared?.payment?.transaction?.to?.toLowerCase() !== paymentRouter.toLowerCase() ||
    prepared.payment.transaction.value !== '0' ||
    prepared.payment.transaction.chainId !== chainId ||
    typeof paymentCalldata !== 'string' ||
    !calldataPattern.test(paymentCalldata)
  ) {
    fail('Local API returned unsafe or inconsistent prepared transaction calldata');
  }

  await writePublicState(outputPath, {
    version: 1,
    chainId,
    rpcUrl,
    apiBaseUrl,
    webBaseUrl,
    intentId: intent.id,
    payerAddress,
    mockKrw,
    paymentRouter,
    approvalCalldata: approvalCalldata.toLowerCase(),
    paymentCalldata: paymentCalldata.toLowerCase(),
  });
  globalThis.console.log('Prepared public local-only wallet E2E state.');
}

try {
  await main();
} catch (error) {
  globalThis.console.error(
    error instanceof FixtureError
      ? error.message
      : 'Preparing the local wallet E2E state failed unexpectedly.',
  );
  process.exitCode = 1;
}
