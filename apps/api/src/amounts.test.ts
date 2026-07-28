import { describe, expect, it } from 'vitest';

import { maxUint256, toChainTimestamp, uintString } from './routes/payment-intents.js';

describe('uint256 amount validation', () => {
  it('accepts the maximum uint256 and rejects larger decimal strings', () => {
    expect(uintString.parse(maxUint256.toString())).toBe(maxUint256.toString());
    expect(() => uintString.parse((maxUint256 + 1n).toString())).toThrow(/uint256/);
  });

  it('rejects zero, signs, leading zeros and non-decimal values', () => {
    for (const value of ['0', '-1', '+1', '01', '1.0', '0x01']) {
      expect(() => uintString.parse(value)).toThrow();
    }
  });

  it('normalizes database validity windows to EVM whole-second timestamps', () => {
    expect(toChainTimestamp(new Date('2026-07-28T00:00:00.999Z')).toISOString()).toBe(
      '2026-07-28T00:00:00.000Z',
    );
  });
});
