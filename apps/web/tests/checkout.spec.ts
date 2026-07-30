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
  await expect(page.getByText('1.00%', { exact: true })).toBeVisible();
  await expect(page.getByText('mock-fixed-rate')).toBeHidden();
  await expect(page.getByText(recipient, { exact: true })).toBeHidden();
  await page.getByText('Payment route and verification details', { exact: true }).click();
  await expect(page.getByText('mock-fixed-rate')).toBeVisible();
  await expect(page.getByText(recipient, { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /Connect wallet/i })).toBeVisible();
  await expect(page.getByText(/payment completes after onchain verification/i)).toBeVisible();

  await page.getByRole('button', { name: '한국어' }).click();
  await expect(page.getByText('판매자가 정확히 받는 금액')).toBeVisible();
  await expect(page.getByRole('heading', { name: '결제 상세' })).toBeVisible();
  await expect(page.getByRole('button', { name: '지갑 연결' })).toBeVisible();
});

test('landing page remains usable on a narrow mobile viewport', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /Pay with anything/i })).toBeVisible();
  await expect(page.getByText('Testnet demo · Mock tokens have no real-world value')).toBeVisible();
  await expect(page.getByRole('group', { name: 'Language / 언어' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'ENGLISH' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.getByText('EIP-712 fixes the token')).toBeHidden();
  await page.getByText('How it works and security boundaries', { exact: true }).click();
  await expect(page.getByText('EIP-712 fixes the token')).toBeVisible();
  await page.getByRole('button', { name: '한국어' }).click();
  await expect(page.getByRole('heading', { name: /결제는 자유롭게/ })).toBeVisible();
  await expect(page.getByText('운영 원리와 보안 경계', { exact: true })).toBeVisible();
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
  await expect(page.getByText('Only chain-verified payment state is shown here.')).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Merchant dashboard' })).toBeVisible();
  await page.getByRole('link', { name: 'API keys' }).click();
  await expect(page.getByRole('heading', { name: 'API keys', exact: true })).toBeVisible();
  await expect(page.getByText('No API keys')).toBeVisible();
});

test('merchant operations keep raw identifiers behind optional details', async ({ page }) => {
  await page.route('http://127.0.0.1:3001/v1/api-keys', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data: [
          {
            id: '30000000-0000-4000-8000-000000000003',
            name: 'Checkout server',
            prefix: 'gp_test_1234',
            scopes: ['payment_intents:read', 'payment_intents:write'],
            expiresAt: null,
            revokedAt: null,
            createdAt: '2026-07-28T00:00:00.000Z',
            lastUsedAt: null,
          },
        ],
      }),
    });
  });
  await page.goto('/dashboard/api-keys');
  await expect(page.getByText('Checkout server')).toBeVisible();
  await expect(page.getByText('gp_test_1234…', { exact: true })).toBeHidden();
  await page.getByText('Credential details', { exact: true }).click();
  await expect(page.getByText('gp_test_1234…', { exact: true })).toBeVisible();

  await page.goto('/dashboard/splits');
  await expect(page.getByText(/compromised invoice signer/i)).toBeHidden();
  await page.getByText('How split templates stay safe', { exact: true }).click();
  await expect(page.getByText(/compromised invoice signer/i)).toBeVisible();

  await page.route('http://127.0.0.1:3001/v1/payment-intents?**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data: [{ ...paymentIntent, status: 'succeeded' }],
        pagination: { limit: 100, offset: 0, hasMore: false },
      }),
    });
  });
  await page.goto('/dashboard/refunds');
  await expect(page.getByText(intentId, { exact: true })).toBeHidden();
  await page.getByText('Payment details', { exact: true }).click();
  await expect(page.getByText(intentId, { exact: true })).toBeVisible();
});

test('payment-link creation keeps advanced settlement settings out of the primary flow', async ({
  page,
}) => {
  await page.route('http://127.0.0.1:3001/v1/payment-intents?**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data: [],
        pagination: { limit: 25, offset: 0, hasMore: false },
      }),
    });
  });
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

  await page.goto('/dashboard/payment-links');

  await expect(page.getByLabel('Product description')).toBeVisible();
  await expect(page.getByLabel('Exact settlement amount')).toBeVisible();
  await expect(page.getByLabel('Expires at')).toBeHidden();
  await expect(page.getByLabel('Registered settlement splitId')).toBeHidden();
  await page.getByText('Advanced settlement settings', { exact: true }).click();
  await expect(page.getByLabel('Expires at')).toBeVisible();
  await expect(page.getByLabel('Registered settlement splitId')).toBeVisible();
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
  await expect(page.getByText('48,000 MockKRW', { exact: true })).toBeVisible();
  await expect(page.getByText(/Local Anvil transaction/)).toBeVisible();
  await expect(page.getByText(verifiedIntent.paymentId, { exact: true })).toBeHidden();
  await page.getByText('Receipt details and verification', { exact: true }).click();
  await expect(page.getByText(verifiedIntent.paymentId, { exact: true })).toBeVisible();
  await expect(page.getByText('48,000 MockKRW received')).toBeVisible();
  await expect(page.getByText(/chain-indexed verification/)).toBeVisible();
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
