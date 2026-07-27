import { describe, expect, it } from 'vitest';

import { isGlobalUnicast } from './http-security.js';

describe('webhook destination IP policy', () => {
  it.each([
    '::',
    '::1',
    '::ffff:127.0.0.1',
    '10.0.0.1',
    '100.64.0.1',
    '169.254.1.1',
    '192.168.1.1',
    '224.0.0.1',
    '2001:db8::1',
    'fc00::1',
    'fe80::1',
  ])('rejects private or reserved destination %s', (address) => {
    expect(isGlobalUnicast(address)).toBe(false);
  });

  it.each(['1.1.1.1', '8.8.8.8', '2606:4700:4700::1111'])(
    'accepts global unicast destination %s',
    (address) => {
      expect(isGlobalUnicast(address)).toBe(true);
    },
  );
});
