import { describe, expect, it } from 'vitest';

import { serializePublicRefund } from './routes/payment-intents.js';

describe('public refund privacy', () => {
  it('never exposes the merchant-internal refund reason', () => {
    const now = new Date();
    const serialized = serializePublicRefund({
      id: crypto.randomUUID(),
      refundId: `0x${'11'.repeat(32)}`,
      paymentIntentId: crypto.randomUUID(),
      merchantId: crypto.randomUUID(),
      idempotencyKey: 'private-idempotency-key',
      amount: '100',
      reason: 'Customer email and internal support note',
      status: 'requested',
      transactionHash: null,
      blockNumber: null,
      blockHash: null,
      logIndex: null,
      chainVerifiedAt: null,
      createdAt: now,
      updatedAt: now,
    });
    expect(serialized).not.toHaveProperty('reason');
    expect(JSON.stringify(serialized)).not.toContain('Customer email');
  });
});
