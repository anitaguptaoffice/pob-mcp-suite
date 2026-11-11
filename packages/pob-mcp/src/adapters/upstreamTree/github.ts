import { createHash } from 'node:crypto';
import { BoundedCache } from '../../infrastructure/cache.js';
import type { UpstreamTreeSnapshot, UpstreamTreeSource } from '../../ports/upstreamTree.js';

const MAX_TREE_BYTES = 32 * 1024 * 1024;
export class GitHubUpstreamTree implements UpstreamTreeSource {
  private readonly cache: BoundedCache<UpstreamTreeSnapshot>;
  constructor(private readonly fetcher: typeof fetch = fetch, private readonly now: () => number = Date.now) { this.cache = new BoundedCache(4, 2, now); }
  async read(treeVersion: string, refresh = false): Promise<UpstreamTreeSnapshot> {
    if (typeof treeVersion !== 'string' || !/^\d{1,2}_\d{1,3}(?:_[A-Za-z0-9_]{1,40})?$/.test(treeVersion) || typeof refresh !== 'boolean') throw new Error('Invalid upstream tree version or refresh option');
    if (refresh) this.cache.invalidate(treeVersion);
    const cached = await this.cache.get(treeVersion, 10 * 60_000, async () => {
      const url = `https://raw.githubusercontent.com/PathOfBuildingCommunity/PathOfBuilding/master/src/TreeData/${treeVersion}/tree.lua`;
      const response = await this.fetcher(url, { headers: { 'User-Agent': 'pob-mcp-suite/1.0' }, signal: AbortSignal.timeout(60000), redirect: 'error' });
      if (!response.ok) { await response.body?.cancel().catch(() => {}); throw new Error(`Upstream tree request returned HTTP ${response.status}`); }
      const declared = response.headers.get('content-length');
      if (declared && /^\d+$/.test(declared) && Number(declared) > MAX_TREE_BYTES) { await response.body?.cancel().catch(() => {}); throw new Error('Upstream tree exceeds the size limit'); }
      if (!response.body) throw new Error('Upstream tree response has no body');
      const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let bytes = 0;
      try {
        for (;;) {
          const { done, value } = await reader.read(); if (done) break;
          bytes += value.byteLength;
          if (bytes > MAX_TREE_BYTES) throw new Error('Upstream tree exceeds the size limit');
          chunks.push(value);
        }
      } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
      if (!bytes) throw new Error('Upstream tree response is empty');
      const buffer = Buffer.concat(chunks, bytes);
      let text: string; try { text = new TextDecoder('utf-8', { fatal: true }).decode(buffer); } catch { throw new Error('Upstream tree is not valid UTF-8'); }
      return { source: 'pob-upstream-github' as const, treeVersion, url, fetchedAt: new Date(this.now()).toISOString(), sha256: createHash('sha256').update(buffer).digest('hex'), bytes, text };
    });
    return { ...cached.value };
  }
}
