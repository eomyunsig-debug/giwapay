type CacheEntry<T> = {
  expiresAt: number;
  value: Promise<T>;
};

/** Small in-process request coalescer for verified chain reads.
 *
 * It is deliberately bounded and never caches failures. Multi-replica
 * deployments still need an edge or shared PostgreSQL rate-limit policy.
 */
export class AsyncTtlCache<T> {
  readonly #entries = new Map<string, CacheEntry<T>>();

  public constructor(private readonly maximumEntries = 1_000) {}

  public get(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
    const now = Date.now();
    const existing = this.#entries.get(key);
    if (existing && existing.expiresAt > now) return existing.value;
    if (existing) this.#entries.delete(key);
    if (this.#entries.size >= this.maximumEntries) this.#prune(now);

    const value = load().catch((error) => {
      if (this.#entries.get(key)?.value === value) this.#entries.delete(key);
      throw error;
    });
    this.#entries.set(key, { expiresAt: now + ttlMs, value });
    return value;
  }

  public delete(key: string) {
    this.#entries.delete(key);
  }

  public clear() {
    this.#entries.clear();
  }

  #prune(now: number) {
    for (const [key, entry] of this.#entries) {
      if (entry.expiresAt <= now) this.#entries.delete(key);
    }
    while (this.#entries.size >= this.maximumEntries) {
      const oldest = this.#entries.keys().next().value as string | undefined;
      if (!oldest) break;
      this.#entries.delete(oldest);
    }
  }
}
