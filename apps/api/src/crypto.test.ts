import { describe, expect, it } from 'vitest';

import {
  derivePurposeSecret,
  decodeSignedPayload,
  decryptSecret,
  encodeSignedPayload,
  encryptSecret,
  safeSecretEqual,
  secretDigest,
  signWebhook,
} from './crypto.js';

describe('secret handling', () => {
  it('encrypts webhook secrets with authenticated encryption', () => {
    const key = Buffer.alloc(32, 7);
    const ciphertext = encryptSecret('whsec_example', key);
    expect(ciphertext).not.toContain('whsec_example');
    expect(decryptSecret(ciphertext, key)).toBe('whsec_example');
    const parts = ciphertext.split('.');
    const encrypted = Buffer.from(parts[3]!, 'base64url');
    encrypted[0] = encrypted[0]! ^ 1;
    parts[3] = encrypted.toString('base64url');
    expect(() => decryptSecret(parts.join('.'), key)).toThrow();
  });

  it('compares only keyed digests', () => {
    const digest = secretDigest('presented', 'p'.repeat(32));
    expect(safeSecretEqual('presented', digest, 'p'.repeat(32))).toBe(true);
    expect(safeSecretEqual('different', digest, 'p'.repeat(32))).toBe(false);
  });

  it('uses the documented timestamp.body webhook signature envelope', () => {
    expect(signWebhook(1_700_000_000, '{"ok":true}', 'secret')).toMatch(
      /^t=1700000000,v1=[0-9a-f]{64}$/,
    );
  });

  it('authenticates stateless quote payloads and rejects tampering', () => {
    const secret = 'q'.repeat(32);
    const token = encodeSignedPayload({ amount: '100', expiresAt: 123 }, secret);
    expect(decodeSignedPayload(token, secret)).toEqual({
      amount: '100',
      expiresAt: 123,
    });
    expect(decodeSignedPayload(`${token}x`, secret)).toBeUndefined();
  });

  it('derives domain-separated keys from the session root', () => {
    const root = 'r'.repeat(32);
    const session = derivePurposeSecret(root, 'session-token');
    const csrf = derivePurposeSecret(root, 'csrf');
    const quote = derivePurposeSecret(root, 'quote-envelope');
    expect(new Set([session, csrf, quote]).size).toBe(3);
    const token = encodeSignedPayload({ purpose: 'quote' }, quote);
    expect(decodeSignedPayload(token, session)).toBeUndefined();
    expect(decodeSignedPayload(token, csrf)).toBeUndefined();
  });
});
