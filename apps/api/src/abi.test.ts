import { describe, expect, it } from 'vitest';
import { decodeEventLog, encodeAbiParameters, encodeEventTopics, getAbiItem } from 'viem';

import { paymentRouterAbi } from './abi.js';

describe('canonical router ABI', () => {
  it('includes per-recipient settlement evidence', () => {
    const event = getAbiItem({ abi: paymentRouterAbi, name: 'SettlementDistributed' });
    expect(event.inputs.map((input) => input.name)).toEqual([
      'intentId',
      'merchant',
      'recipient',
      'settlementToken',
      'amount',
      'basisPoints',
    ]);
  });

  it('keeps refundId indexed and independently traceable', () => {
    const event = getAbiItem({ abi: paymentRouterAbi, name: 'Refunded' });
    const intentId = `0x${'11'.repeat(32)}` as const;
    const refundId = `0x${'22'.repeat(32)}` as const;
    const merchant = '0x0000000000000000000000000000000000000001';
    const topics = encodeEventTopics({
      abi: [event],
      eventName: 'Refunded',
      args: { intentId, refundId, merchant },
    });
    const data = encodeAbiParameters(
      [
        { type: 'address' },
        { type: 'address' },
        { type: 'uint256' },
        { type: 'uint256' },
        { type: 'address' },
      ],
      [
        '0x0000000000000000000000000000000000000002',
        '0x0000000000000000000000000000000000000003',
        10n,
        10n,
        merchant,
      ],
    );
    const decoded = decodeEventLog({
      abi: paymentRouterAbi,
      data,
      topics,
      strict: true,
    });
    expect(decoded.eventName).toBe('Refunded');
    expect(decoded.args).toMatchObject({ intentId, refundId, merchant });
  });
});
