import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { BuildFileCatalog, BuildFileCatalogResult } from '../../ports/buildFileCatalog.js';

/** Discover local XML files without importing or following symlinks. */
export class LocalBuildFileCatalog implements BuildFileCatalog {
  constructor(private readonly directory: string, private readonly maxEntries = 50000, private readonly maxDepth = 32) {}
  async scan(): Promise<BuildFileCatalogResult> {
    const root = await fs.realpath(this.directory);
    if (!(await fs.stat(root)).isDirectory()) throw new Error('Configured build directory is not a directory');
    const names: string[] = [], issues: BuildFileCatalogResult['issues'] = [];
    let inspected = 0, capped = false;
    const walk = async (relative: string, depth: number): Promise<void> => {
      if (capped) return;
      let entries;
      try {
        const directory = path.join(root, relative);
        if (relative) {
          const info = await fs.lstat(directory);
          if (!info.isDirectory()) { issues.push({ path: relative, reason: 'DIRECTORY_CHANGED' }); return; }
          const resolved = await fs.realpath(directory);
          if (!resolved.startsWith(root + path.sep)) { issues.push({ path: relative, reason: 'OUTSIDE_DIRECTORY' }); return; }
        }
        entries = await fs.readdir(directory, { withFileTypes: true });
      }
      catch (error) {
        if (!relative) throw error;
        issues.push({ path: relative, reason: (error as NodeJS.ErrnoException).code ?? 'READ_FAILED' }); return;
      }
      entries.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
      for (const entry of entries) {
        if (++inspected > this.maxEntries) { capped = true; issues.push({ path: relative || '.', reason: 'ENTRY_LIMIT' }); return; }
        if (entry.name.startsWith('.') || entry.name.startsWith('~~temp~~')) continue;
        const item = relative ? path.join(relative, entry.name) : entry.name;
        if (entry.isDirectory()) {
          if (depth >= this.maxDepth) issues.push({ path: item, reason: 'DEPTH_LIMIT' });
          else await walk(item, depth + 1);
        } else if (entry.isFile() && /\.xml$/i.test(entry.name)) names.push(item);
        if (capped) return;
      }
    };
    await walk('', 0);
    names.sort();
    return { directory: root, names, complete: issues.length === 0, issues };
  }
}
