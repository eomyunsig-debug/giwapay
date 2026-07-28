import type { LookupAddress } from 'node:dns';
import { lookup } from 'node:dns/promises';
import ipaddr from 'ipaddr.js';

import type { AppConfig } from './env.js';
import { HttpError } from './errors.js';

export function requireAllowedOrigin(originHeader: string | undefined, config: AppConfig): string {
  if (!originHeader) {
    throw new HttpError(403, 'origin_required', 'Origin header is required');
  }
  let origin: string;
  try {
    origin = new URL(originHeader).origin;
  } catch {
    throw new HttpError(403, 'origin_invalid', 'Origin header is invalid');
  }
  if (!config.allowedOrigins.includes(origin)) {
    throw new HttpError(403, 'origin_denied', 'Origin is not allowed');
  }
  return origin;
}

export function isGlobalUnicast(address: string): boolean {
  if (!ipaddr.isValid(address)) return false;
  const parsed = ipaddr.parse(address);
  if (parsed.kind() === 'ipv6' && (parsed as ipaddr.IPv6).isIPv4MappedAddress()) {
    return (parsed as ipaddr.IPv6).toIPv4Address().range() === 'unicast';
  }
  return parsed.range() === 'unicast';
}

export type ResolvedWebhookTarget = {
  url: URL;
  addresses: LookupAddress[];
};

export async function resolveSafeWebhookTarget(
  value: string,
  production: boolean,
): Promise<ResolvedWebhookTarget> {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new HttpError(400, 'webhook_url_invalid', 'Webhook URL is invalid');
  }
  if (url.username || url.password) {
    throw new HttpError(400, 'webhook_url_credentials', 'Webhook URLs cannot contain credentials');
  }
  if (production && url.protocol !== 'https:') {
    throw new HttpError(
      400,
      'webhook_url_https_required',
      'Production webhook URLs must use HTTPS',
    );
  }
  if (!production && !['http:', 'https:'].includes(url.protocol)) {
    throw new HttpError(400, 'webhook_url_protocol', 'Webhook URL must use HTTP or HTTPS');
  }

  let addresses: LookupAddress[];
  try {
    addresses = await lookup(url.hostname, { all: true });
  } catch {
    throw new HttpError(
      400,
      'webhook_url_unresolvable',
      'Webhook URL hostname could not be resolved',
    );
  }
  if (
    addresses.length === 0 ||
    (production && addresses.some((entry) => !isGlobalUnicast(entry.address)))
  ) {
    throw new HttpError(
      400,
      'webhook_url_private_address',
      'Webhook URL cannot resolve to a private or reserved address',
    );
  }
  return { url, addresses };
}

export async function assertSafeWebhookUrl(value: string, production: boolean): Promise<URL> {
  return (await resolveSafeWebhookTarget(value, production)).url;
}
