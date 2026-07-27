import { describe, expect, it } from 'vitest';

import {
  buildContentSecurityPolicy,
  safeConfiguredConnectOrigins,
  walletConnectRelayOrigins,
} from './csp';

describe('CSP connect origins', () => {
  it('allows configured local API and RPC origins', () => {
    expect(
      safeConfiguredConnectOrigins([
        'http://127.0.0.1:3001/v1',
        'http://127.0.0.1:8545, wss://rpc.example/ws',
      ]),
    ).toEqual(['http://127.0.0.1:3001', 'http://127.0.0.1:8545', 'wss://rpc.example']);
  });

  it('rejects injection, credentials, and non-network schemes', () => {
    expect(
      safeConfiguredConnectOrigins([
        'https://safe.example; script-src *',
        'https://user:secret@example.com',
        'javascript:alert(1)',
      ]),
    ).toEqual([]);
  });

  it('allows eval only for the Next.js development runtime', () => {
    const production = buildContentSecurityPolicy({
      connectOrigins: ['https://api.example'],
      isDevelopment: false,
    });
    const development = buildContentSecurityPolicy({
      connectOrigins: [],
      isDevelopment: true,
    });

    expect(production).toContain("script-src 'self' 'unsafe-inline'");
    expect(production).not.toContain("'unsafe-eval'");
    expect(production).toContain("connect-src 'self' https://api.example");
    const productionConnectSources =
      production
        .split('; ')
        .find((directive) => directive.startsWith('connect-src'))
        ?.split(' ')
        .slice(1) ?? [];
    expect(productionConnectSources).not.toContain('http:');
    expect(productionConnectSources).not.toContain('https:');
    expect(productionConnectSources).not.toContain('ws:');
    expect(productionConnectSources).not.toContain('wss:');
    expect(development).toContain("'unsafe-eval'");
    expect(development).toContain("connect-src 'self' http: https: ws: wss:");
  });

  it('allows WalletConnect relay origins only when a project is configured', () => {
    expect(walletConnectRelayOrigins(undefined)).toEqual([]);
    expect(walletConnectRelayOrigins(' ')).toEqual([]);
    expect(walletConnectRelayOrigins('project-id')).toEqual([
      'https://relay.walletconnect.com',
      'wss://relay.walletconnect.com',
      'https://pulse.walletconnect.org',
      'https://verify.walletconnect.com',
    ]);
  });
});
