import { describe, expect, it } from 'vitest';

import { parseDeploymentEnvironment } from '../src/runtime.js';

describe('parseDeploymentEnvironment', () => {
  it('rejects test contracts in production', () => {
    expect(() =>
      parseDeploymentEnvironment({ NODE_ENV: 'production', ALLOW_TEST_CONTRACTS: 'true' }),
    ).toThrow('Production configuration must not enable test contracts');
  });

  it('normalizes fallback RPC URLs', () => {
    const result = parseDeploymentEnvironment({
      GIWA_RPC_FALLBACK_URLS: 'https://rpc-a.example, https://rpc-b.example',
    });

    expect(result.GIWA_RPC_FALLBACK_URLS).toEqual([
      'https://rpc-a.example',
      'https://rpc-b.example',
    ]);
  });
});
