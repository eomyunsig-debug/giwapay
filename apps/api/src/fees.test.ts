import { describe, expect, it } from 'vitest';

import { calculatePlatformFee } from './fees.js';

describe('PaymentRouter-compatible fee rounding', () => {
  it('rounds up exactly like Solidity Math.mulDiv(..., Ceil)', () => {
    expect(calculatePlatformFee(1n, 50)).toBe(1n);
    expect(calculatePlatformFee(200n, 50)).toBe(1n);
    expect(calculatePlatformFee(201n, 50)).toBe(2n);
    expect(calculatePlatformFee(10_000n, 0)).toBe(0n);
  });
});
