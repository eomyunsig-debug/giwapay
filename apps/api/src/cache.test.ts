import { describe, expect, it, vi } from 'vitest';

import { AsyncTtlCache } from './cache.js';

describe('AsyncTtlCache', () => {
  it('coalesces concurrent loads and expires values', async () => {
    vi.useFakeTimers();
    const cache = new AsyncTtlCache<number>();
    let calls = 0;
    const load = async () => ++calls;

    await expect(
      Promise.all([cache.get('key', 1_000, load), cache.get('key', 1_000, load)]),
    ).resolves.toEqual([1, 1]);
    expect(calls).toBe(1);
    vi.advanceTimersByTime(1_001);
    await expect(cache.get('key', 1_000, load)).resolves.toBe(2);
    vi.useRealTimers();
  });

  it('does not retain rejected reads', async () => {
    const cache = new AsyncTtlCache<number>();
    let calls = 0;
    const load = async () => {
      calls += 1;
      if (calls === 1) throw new Error('temporary RPC failure');
      return calls;
    };

    await expect(cache.get('key', 1_000, load)).rejects.toThrow(/temporary/);
    await expect(cache.get('key', 1_000, load)).resolves.toBe(2);
  });
});
