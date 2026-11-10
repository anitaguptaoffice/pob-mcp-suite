export interface CacheRead<T> { value: T; cached: boolean; loadedAt: number }
interface CacheEntry<T> { value: T; expiresAt: number; loadedAt: number }

/**
 * In-memory LRU with bounded in-flight loads. Callers own key construction,
 * must use one TTL policy per key, and must not mutate cached values. Source
 * timestamps belong in the loaded value and are never rewritten here.
 */
export class BoundedCache<T> {
  private readonly entries = new Map<string, CacheEntry<T>>();
  private readonly pending = new Map<string, Promise<CacheRead<T>>>();
  private active = 0;
  constructor(private readonly capacity: number, private readonly maxInflight: number, private readonly now: () => number = Date.now) {
    if (!Number.isInteger(capacity) || capacity < 1 || !Number.isInteger(maxInflight) || maxInflight < 1) throw new Error('Invalid cache limits');
  }
  async get(key: string, ttlMs: number, load: () => Promise<T>): Promise<CacheRead<T>> {
    if (!key || !Number.isFinite(ttlMs) || ttlMs <= 0) throw new Error('Invalid cache key or TTL');
    const entry = this.entries.get(key);
    if (entry && entry.expiresAt > this.now()) {
      this.entries.delete(key);
      this.entries.set(key, entry);
      return { value: entry.value, cached: true, loadedAt: entry.loadedAt };
    }
    if (entry) this.entries.delete(key);
    const existing = this.pending.get(key);
    if (existing) return existing;
    if (this.active >= this.maxInflight) throw new Error('Cache load limit reached');
    this.active++;
    const request = Promise.resolve().then(load).then(value => {
      const loadedAt = this.now();
      if (this.pending.get(key) === request) {
        this.entries.set(key, { value, loadedAt, expiresAt: loadedAt + ttlMs });
        while (this.entries.size > this.capacity) this.entries.delete(this.entries.keys().next().value!);
      }
      return { value, cached: false, loadedAt };
    }).finally(() => {
      this.active--;
      if (this.pending.get(key) === request) this.pending.delete(key);
    });
    this.pending.set(key, request);
    return request;
  }
  invalidate(key: string): void { this.entries.delete(key); this.pending.delete(key); }
  clear(): void { this.entries.clear(); this.pending.clear(); }
}
