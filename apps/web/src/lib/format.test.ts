import { describe, expect, it } from 'vitest';

import { formatBasisPoints, formatRawAmount, isFinalPaymentStatus, shortAddress } from './format';

describe('format helpers', () => {
  it('shortens an address without losing its identity', () => {
    expect(shortAddress('0x1234567890123456789012345678901234567890')).toBe('0x1234…7890');
  });

  it('formats basis points accurately', () => {
    expect(formatBasisPoints(75)).toBe('0.75%');
  });

  it('formats raw token units without floating-point conversion', () => {
    expect(formatRawAmount('48000000000', 6)).toBe('48,000');
  });

  it('does not consider a submitted transaction successful', () => {
    expect(isFinalPaymentStatus('submitted')).toBe(false);
    expect(isFinalPaymentStatus('succeeded')).toBe(true);
  });
});
