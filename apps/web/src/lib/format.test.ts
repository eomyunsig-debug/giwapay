import { describe, expect, it } from 'vitest';

import {
  formatBasisPoints,
  formatConfiguredAmount,
  formatMaximumRawAmount,
  formatRawAmount,
  isFinalPaymentStatus,
  shortAddress,
} from './format';

describe('format helpers', () => {
  it('shortens an address without losing its identity', () => {
    expect(shortAddress('0x1234567890123456789012345678901234567890')).toBe('0x1234…7890');
  });

  it('formats basis points accurately', () => {
    expect(formatBasisPoints(75)).toBe('0.75%');
  });

  it('formats raw token units without floating-point conversion', () => {
    expect(formatRawAmount('48000000000', 6)).toBe('48,000');
    expect(formatRawAmount('123456789', 9)).toBe('0.123457');
  });

  it('never renders a non-zero amount as zero', () => {
    expect(formatRawAmount('900000000000', 18)).toBe('0.0000009');
    expect(formatRawAmount('1', 18)).toBe('<0.000000000001');
  });

  it('rounds maximum input upward and fails visibly without token metadata', () => {
    expect(formatMaximumRawAmount('123456001', 9)).toBe('0.123457');
    expect(formatConfiguredAmount('25000000', undefined)).toBe('25000000 atomic units');
  });

  it('does not consider a submitted transaction successful', () => {
    expect(isFinalPaymentStatus('submitted')).toBe(false);
    expect(isFinalPaymentStatus('succeeded')).toBe(true);
  });
});
