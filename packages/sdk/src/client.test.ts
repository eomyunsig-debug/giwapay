import { describe, expect, it, vi } from 'vitest';

import { GiwaPayClient } from './client.js';
import { positiveUintStringSchema, uintStringSchema } from './schemas.js';

const paymentIntent = {
  id: '10000000-0000-4000-8000-000000000001',
  paymentId: `0x${'12'.repeat(32)}`,
  status: 'created',
  merchant: {
    name: 'Test merchant',
    payoutAddress: `0x${'34'.repeat(20)}`,
  },
  description: 'Testnet demo purchase',
  settlement: {
    token: `0x${'56'.repeat(20)}`,
    amount: '1000000',
  },
  settlementRecipients: [{ address: `0x${'34'.repeat(20)}`, basisPoints: 10_000 }],
  splitId: `0x${'78'.repeat(32)}`,
  splitHash: `0x${'79'.repeat(32)}`,
  platformFee: '5000',
  validAfter: '2026-07-28T00:00:00.000Z',
  expiresAt: '2027-01-01T00:00:00.000Z',
  payerRestriction: '0x0000000000000000000000000000000000000000',
  chainId: 91342,
  routerAddress: `0x${'90'.repeat(20)}`,
  signerAddress: `0x${'91'.repeat(20)}`,
  signature: `0x${'ab'.repeat(65)}`,
  typedData: {},
  payment: null,
  refundedAmount: '0',
  createdAt: '2026-07-28T00:00:00.000Z',
  updatedAt: '2026-07-28T00:00:00.000Z',
};

describe('GiwaPayClient', () => {
  it('rejects amounts that cannot fit in an EVM uint256', () => {
    const maximum = ((1n << 256n) - 1n).toString();
    const overflow = (1n << 256n).toString();

    expect(uintStringSchema.parse(maximum)).toBe(maximum);
    expect(positiveUintStringSchema.parse(maximum)).toBe(maximum);
    expect(uintStringSchema.safeParse(overflow).success).toBe(false);
    expect(positiveUintStringSchema.safeParse(overflow).success).toBe(false);
  });

  it('validates payment intent responses', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ paymentIntent, refunds: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const client = new GiwaPayClient({
      baseUrl: 'https://api.example.test/',
      fetch: fetchMock,
    });

    const result = await client.getPaymentIntent(paymentIntent.id);

    expect(result.paymentIntent.chainId).toBe(91342);
    expect(fetchMock).toHaveBeenCalledWith(
      `https://api.example.test/v1/payment-intents/${paymentIntent.id}`,
      expect.objectContaining({ credentials: 'include', method: 'GET' }),
    );
  });

  it('uses an API key without exposing it in a URL', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [],
          pagination: { limit: 25, offset: 0, hasMore: false },
        }),
        {
          status: 200,
        },
      ),
    );
    const client = new GiwaPayClient({
      baseUrl: 'https://api.example.test',
      apiKey: 'gp_test_secret',
      fetch: fetchMock,
    });

    await client.listPaymentIntents();

    const request = fetchMock.mock.calls[0]?.[1];
    expect(new Headers(request?.headers).get('Authorization')).toBe('Bearer gp_test_secret');
    expect(fetchMock.mock.calls[0]?.[0]).not.toContain('gp_test_secret');
  });

  it('surfaces structured API failures', async () => {
    const client = new GiwaPayClient({
      baseUrl: 'https://api.example.test',
      fetch: vi.fn<typeof fetch>().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: { code: 'INTENT_EXPIRED', message: 'Intent expired' },
          }),
          { status: 409 },
        ),
      ),
    });

    await expect(
      client.createPaymentIntent({
        idempotencyKey: 'test-request-0001',
        description: 'Order',
        settlementToken: `0x${'11'.repeat(20)}`,
        settlementAmount: '100',
        splitId: `0x${'22'.repeat(32)}`,
        expiresAt: '2027-01-01T00:00:00.000Z',
      }),
    ).rejects.toMatchObject({
      status: 409,
      code: 'INTENT_EXPIRED',
    });
  });

  it('resumes a pending refund without changing its on-chain identity', async () => {
    const refundId = `0x${'cd'.repeat(32)}` as const;
    const refundPreparation = {
      refund: {
        id: '10000000-0000-4000-8000-000000000002',
        refundId,
        status: 'requested',
        amount: '100',
        transactionHash: null,
        explorerUrl: null,
        blockNumber: null,
        verifiedAt: null,
        createdAt: '2026-07-28T00:00:00.000Z',
        updatedAt: '2026-07-28T00:00:00.000Z',
      },
      approval: {
        to: `0x${'56'.repeat(20)}`,
        data: '0x1234',
        value: '0',
      },
      transaction: {
        to: `0x${'90'.repeat(20)}`,
        data: '0xabcd',
        value: '0',
        chainId: 91342,
      },
    };
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(
      new Response(JSON.stringify(refundPreparation), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const client = new GiwaPayClient({
      baseUrl: 'https://api.example.test',
      fetch: fetchMock,
    });

    const resumed = await client.resumeRefund(paymentIntent.id, refundId);

    expect(resumed.refund.refundId).toBe(refundId);
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      `https://api.example.test/v1/payment-intents/${paymentIntent.id}/refunds/${refundId}/resume`,
      expect.objectContaining({ method: 'POST' }),
    );
  });
});
