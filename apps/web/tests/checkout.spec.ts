import { expect, test } from '@playwright/test';

const intentId = '10000000-0000-4000-8000-000000000001';
const mockKrw = '0x1000000000000000000000000000000000000001';
const mockUsdc = '0x2000000000000000000000000000000000000002';
const merchant = '0x4000000000000000000000000000000000000004';
const router = '0x5000000000000000000000000000000000000005';
const recipient = '0x6000000000000000000000000000000000000006';
const adapter = '0x7000000000000000000000000000000000000007';
const futureDate = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

const paymentIntent = {
  id: intentId,
  paymentId: `0x${'11'.repeat(32)}`,
  status: 'created',
  merchant: { name: 'Testnet Namu Studio', payoutAddress: recipient },
  description: 'Testnet demo design toolkit',
  settlement: { token: mockKrw, amount: '48000000000' },
  settlementRecipients: [{ address: recipient, basisPoints: 10000 }],
  splitId: `0x${'00'.repeat(32)}`,
  splitHash: `0x${'01'.repeat(32)}`,
  platformFee: '240000000',
  validAfter: '2026-07-28T00:00:00.000Z',
  expiresAt: futureDate,
  payerRestriction: '0x0000000000000000000000000000000000000000',
  chainId: 91342,
  routerAddress: router,
  signerAddress: merchant,
  signature: `0x${'ab'.repeat(65)}`,
  typedData: {},
  payment: null,
  refundedAmount: '0',
  createdAt: '2026-07-28T00:00:00.000Z',
  updatedAt: '2026-07-28T00:00:00.000Z',
};
const merchantProfile = {
  id: '20000000-0000-4000-8000-000000000002',
  onchainMerchantAddress: merchant,
  adminAddress: merchant,
  payoutAddress: recipient,
  delegatedSignerAddress: merchant,
  refundOperatorAddress: null,
  status: 'active',
  onchainRegisteredAt: '2026-07-28T00:00:00.000Z',
  displayName: 'Testnet Namu Studio',
  createdAt: '2026-07-28T00:00:00.000Z',
  updatedAt: '2026-07-28T00:00:00.000Z',
};

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => window.localStorage.setItem('giwapay.locale', 'en'));
});

test('hosted checkout displays a live API-backed exact-output quote', async ({ page }) => {
  await page.route('http://127.0.0.1:3001/v1/payment-methods**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data: [
          {
            token: {
              address: mockUsdc,
              symbol: 'MockUSDC',
              name: 'MockUSDC',
              decimals: 6,
              testOnly: true,
            },
            settlementToken: {
              address: mockKrw,
              symbol: 'MockKRW',
              name: 'MockKRW',
              decimals: 6,
              testOnly: true,
            },
            route: {
              adapter,
              adapterIdentifier: 'mock-fixed-rate',
              defaultSlippageBps: 100,
              maxInputCap: '1000000000',
            },
          },
        ],
      }),
    });
  });
  await page.route(`http://127.0.0.1:3001/v1/payment-intents/${intentId}`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ paymentIntent, refunds: [] }),
    });
  });
  await page.route(
    `http://127.0.0.1:3001/v1/payment-intents/${intentId}/quote**`,
    async (route) => {
      const tokenIn = new URL(route.request().url()).searchParams.get('tokenIn');
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          quoteId: `test.${'a'.repeat(64)}`,
          tokenIn: tokenIn ?? mockUsdc,
          settlementToken: mockKrw,
          exactMerchantAmount: '48000000000',
          platformFee: '240000000',
          estimatedInputAmount: '48240000',
          maximumInputAmount: '48722400',
          slippageBps: 100,
          adapter,
          adapterIdentifier: 'mock-fixed-rate',
          settlementRecipients: [{ address: recipient, basisPoints: 10000 }],
          router,
          approvalSpender: router,
          quotedAt: '2026-07-28T00:00:00.000Z',
          expiresAt: futureDate,
        }),
      });
    },
  );

  await page.goto(`/checkout/${intentId}`);

  await expect(page.getByText('Testnet demo · Mock tokens')).toBeVisible();
  await expect(page.getByText('Testnet Namu Studio')).toBeVisible();
  await expect(page.getByText('Testnet demo design toolkit')).toBeVisible();
  await expect(page.getByText('48,000 MockKRW')).toBeVisible();
  await expect(page.getByText('mock-fixed-rate')).toBeVisible();
  await expect(page.getByText('1.00%', { exact: true })).toBeVisible();
  await expect(page.getByText(recipient, { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /Connect wallet/i })).toBeVisible();
  await expect(page.getByText(/wallet submission is not a successful payment/i)).toBeVisible();

  await page.getByRole('button', { name: '한국어로 전환' }).click();
  await expect(page.getByText('판매자가 정확히 받는 금액')).toBeVisible();
  await expect(page.getByRole('heading', { name: '결제 상세' })).toBeVisible();
  await expect(page.getByRole('button', { name: '지갑 연결' })).toBeVisible();
});

test('landing page remains usable on a narrow mobile viewport', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /Pay with anything/i })).toBeVisible();
  await expect(page.getByText('Testnet demo · No real-value token')).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(overflow).toBe(false);
});

test('merchant dashboard exposes navigation and chain-verified copy', async ({ page }) => {
  await page.route('http://127.0.0.1:3001/v1/payment-intents?**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data: [paymentIntent],
        pagination: { limit: 50, offset: 0, hasMore: false },
      }),
    });
  });
  await page.route('http://127.0.0.1:3001/v1/merchants/me', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        merchant: merchantProfile,
        requiredDelegatedSignerAddress: merchant,
      }),
    });
  });
  await page.route('http://127.0.0.1:3001/v1/api-keys', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: [] }),
    });
  });

  await page.goto('/dashboard');

  await expect(page.getByRole('heading', { name: 'Testnet Namu Studio' })).toBeVisible();
  await expect(
    page.getByText('The latest 50 records below come from the chain-indexed database.'),
  ).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Merchant dashboard' })).toBeVisible();
  await page.getByRole('link', { name: 'API keys' }).click();
  await expect(page.getByRole('heading', { name: 'API keys', exact: true })).toBeVisible();
  await expect(page.getByText('No API keys')).toBeVisible();
});

test('receipt success is derived from verified API state and supports local hashes', async ({
  page,
}) => {
  const verifiedIntent = {
    ...paymentIntent,
    status: 'succeeded',
    settlementRecipients: [
      {
        address: recipient,
        basisPoints: 10000,
        amount: '48000000000',
      },
    ],
    payment: {
      payer: '0x8000000000000000000000000000000000000008',
      inputToken: mockUsdc,
      inputAmount: '48240000',
      platformFee: '240000000',
      transactionHash: `0x${'99'.repeat(32)}`,
      explorerUrl: null,
      blockNumber: '42',
      blockHash: `0x${'88'.repeat(32)}`,
      logIndex: 1,
      verifiedAt: '2026-07-28T00:10:00.000Z',
    },
  };
  await page.route(`http://127.0.0.1:3001/v1/payment-intents/${intentId}`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ paymentIntent: verifiedIntent, refunds: [] }),
    });
  });

  await page.goto(`/receipt/${intentId}`);

  await expect(page.getByRole('heading', { name: 'Payment verified' })).toBeVisible();
  await expect(page.getByText(/independently matched/)).toBeVisible();
  await expect(page.getByText('48,000 MockKRW received')).toBeVisible();
  await expect(page.getByText(/Local Anvil transaction/)).toBeVisible();
  await expect(page.locator(`a[href*="sepolia-explorer.giwa.io/tx"]`)).toHaveCount(0);
});

test('checkout fails closed when the public payment-method registry is empty', async ({ page }) => {
  await page.route('http://127.0.0.1:3001/v1/payment-methods**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: [] }),
    });
  });
  await page.route(`http://127.0.0.1:3001/v1/payment-intents/${intentId}`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ paymentIntent, refunds: [] }),
    });
  });

  await page.goto(`/checkout/${intentId}`);

  await expect(page.getByText('No verified payment tokens configured')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Approve & pay' })).toHaveCount(0);
});

test('reduced-motion preference disables nonessential transitions', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  expect(
    await page.evaluate(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches),
  ).toBe(true);
  const duration = await page
    .locator('.action-link')
    .first()
    .evaluate((element) => Number.parseFloat(getComputedStyle(element).transitionDuration));
  expect(duration).toBeLessThanOrEqual(0.001);
});
