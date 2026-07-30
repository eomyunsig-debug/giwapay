import { createHmac } from 'node:crypto';

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

const base64UrlAlphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

function nonCanonicalBase64UrlAlias(value: string): string {
  if (value.length % 4 === 0) throw new Error('Fixture has no unused base64url bits');
  const finalIndex = base64UrlAlphabet.indexOf(value.at(-1)!);
  if (finalIndex < 0) throw new Error('Fixture is not base64url');
  return `${value.slice(0, -1)}${base64UrlAlphabet[finalIndex + 1]}`;
}

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

  it('rejects a non-canonical base64url alias of the same signature bytes', () => {
    const secret = 'q'.repeat(32);
    const token = encodeSignedPayload({ amount: '100', expiresAt: 123 }, secret);
    const [payload, signature] = token.split('.');
    if (!payload || !signature) throw new Error('Malformed signed-payload fixture');

    const alias = nonCanonicalBase64UrlAlias(signature);
    expect(Buffer.from(alias, 'base64url')).toEqual(Buffer.from(signature, 'base64url'));
    expect(decodeSignedPayload(`${payload}.${alias}`, secret)).toBeUndefined();
  });

  it('rejects a valid signature over a non-canonical payload encoding', () => {
    const secret = 'q'.repeat(32);
    const token = encodeSignedPayload({ amount: '100', expiresAt: 123 }, secret);
    const [payload] = token.split('.');
    if (!payload) throw new Error('Malformed signed-payload fixture');

    const alias = nonCanonicalBase64UrlAlias(payload);
    expect(Buffer.from(alias, 'base64url')).toEqual(Buffer.from(payload, 'base64url'));
    const signature = createHmac('sha256', secret).update(alias, 'utf8').digest('base64url');
    expect(decodeSignedPayload(`${alias}.${signature}`, secret)).toBeUndefined();
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
