import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export function randomSiweNonce(): string {
  return randomBytes(18).toString('hex');
}

export function secretDigest(secret: string, pepper: string): string {
  return createHmac('sha256', pepper).update(secret, 'utf8').digest('hex');
}

export function safeSecretEqual(
  presented: string,
  expectedDigest: string,
  pepper: string,
): boolean {
  const presentedDigest = Buffer.from(secretDigest(presented, pepper), 'hex');
  const expected = Buffer.from(expectedDigest, 'hex');
  return presentedDigest.length === expected.length && timingSafeEqual(presentedDigest, expected);
}

export function encryptSecret(secret: string, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ['v1', iv, tag, encrypted]
    .map((part) => (typeof part === 'string' ? part : part.toString('base64url')))
    .join('.');
}

export function decryptSecret(ciphertext: string, key: Buffer): string {
  const [version, ivValue, tagValue, encryptedValue] = ciphertext.split('.');
  if (version !== 'v1' || !ivValue || !tagValue || !encryptedValue) {
    throw new Error('Invalid encrypted secret envelope');
  }
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivValue, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagValue, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedValue, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}

export function signWebhook(timestamp: number, rawBody: string, secret: string): string {
  const signature = createHmac('sha256', secret)
    .update(`${timestamp}.${rawBody}`, 'utf8')
    .digest('hex');
  return `t=${timestamp},v1=${signature}`;
}

export function encodeSignedPayload(value: Record<string, unknown>, secret: string): string {
  const payload = Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
  const signature = createHmac('sha256', secret).update(payload, 'utf8').digest('base64url');
  return `${payload}.${signature}`;
}

export function decodeSignedPayload(token: string, secret: string): unknown | undefined {
  const [payload, signature, extra] = token.split('.');
  if (!payload || !signature || extra) return undefined;
  const expected = createHmac('sha256', secret).update(payload, 'utf8').digest();
  let presented: Buffer;
  try {
    presented = Buffer.from(signature, 'base64url');
  } catch {
    return undefined;
  }
  if (presented.length !== expected.length || !timingSafeEqual(presented, expected)) {
    return undefined;
  }
  try {
    return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return undefined;
  }
}
