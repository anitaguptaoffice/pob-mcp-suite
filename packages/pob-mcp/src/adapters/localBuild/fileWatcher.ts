import { randomUUID } from 'node:crypto';
import { promises as fs, type Stats } from 'node:fs';
import path from 'node:path';
import chokidar, { type FSWatcher } from 'chokidar';
import type { BuildFileChange, BuildFileChangeType, BuildFileWatch, BuildFileWatchStatus } from '../../ports/buildFileWatch.js';

/** Process-local observation only: no build is imported or modified. */
export class LocalBuildFileWatcher implements BuildFileWatch {
  private watcher: FSWatcher | null = null;
  private state: BuildFileWatchStatus['state'] = 'stopped';
  private error: string | null = null;
  private root: string;
  private readonly sessionId = randomUUID();
  private sequence = 0;
  private events: BuildFileChange[] = [];
  private pending = new Map<string, { type: BuildFileChangeType; timer: NodeJS.Timeout }>();
  private queue: Promise<unknown> = Promise.resolve();
  private closing: Promise<void> | null = null;
  private healthTimer: NodeJS.Timeout | null = null;
  constructor(directory: string, private readonly maxEvents = 100, private readonly debounceMs = 250) { this.root = path.resolve(directory); }
  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const result = this.queue.then(fn, fn); this.queue = result.catch(() => {}); return result;
  }
  status(): BuildFileWatchStatus { return { state: this.state, directory: this.root, sessionId: this.sessionId, latestSequence: this.sequence, oldestSequence: this.events[0]?.sequence ?? null, error: this.error }; }
  changes(afterSequence: number, limit: number) {
    const status = this.status(), events = this.events.filter(event => event.sequence > afterSequence).slice(0, limit).map(event => ({ ...event }));
    return { status, events, nextSequence: events.at(-1)?.sequence ?? afterSequence, lostBefore: status.oldestSequence !== null && afterSequence < status.oldestSequence - 1 };
  }
  private relative(file: string): string | null {
    const relative = path.relative(this.root, path.resolve(file));
    if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative) || relative.split(path.sep).some(part => part.startsWith('.') || part.startsWith('~~temp~~'))) return null;
    return relative;
  }
  private append(name: string, type: BuildFileChangeType): void {
    this.events.push({ sequence: ++this.sequence, path: name, type, observedAt: new Date().toISOString() });
    if (this.events.length > this.maxEvents) this.events.splice(0, this.events.length - this.maxEvents);
  }
  private record(file: string, type: BuildFileChangeType): void {
    const name = this.relative(file);
    if (!name || !/\.xml$/i.test(name) || this.state !== 'running') return;
    const old = this.pending.get(name);
    if (old) clearTimeout(old.timer);
    const combined = old?.type === 'added' && type === 'modified' ? 'added' : old?.type === 'deleted' && type === 'added' ? 'modified' : type;
    const timer = setTimeout(() => { this.pending.delete(name); this.append(name, combined); }, this.debounceMs);
    timer.unref?.(); this.pending.set(name, { type: combined, timer });
  }
  private flush(): void {
    for (const [name, event] of this.pending) { clearTimeout(event.timer); this.append(name, event.type); }
    this.pending.clear();
  }
  start(): Promise<BuildFileWatchStatus> { return this.serial(async () => {
    if (this.state === 'running') return this.status();
    if (this.closing) { await this.closing; this.closing = null; }
    this.state = 'starting'; this.error = null;
    let watcher: FSWatcher | null = null;
    try {
      const root = await fs.realpath(this.root);
      const rootStat = await fs.stat(root);
      if (!rootStat.isDirectory()) throw new Error('Configured build directory is not a directory');
      this.root = root;
      watcher = chokidar.watch(root, { ignoreInitial: true, followSymlinks: false, atomic: true, awaitWriteFinish: { stabilityThreshold: 500, pollInterval: 100 }, ignored: (candidate: string, stats?: Stats) => candidate !== root && (this.relative(candidate) === null || !!stats?.isSymbolicLink()) });
      this.watcher = watcher;
      const current = watcher;
      watcher.on('add', file => this.record(file, 'added')).on('change', file => this.record(file, 'modified')).on('unlink', file => this.record(file, 'deleted'));
      watcher.on('unlinkDir', file => { if (path.resolve(file) === this.root && this.watcher === current && this.state === 'running') this.fail('Configured build directory was removed', current); });
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Build watcher startup timed out')), 15000); timer.unref?.();
        current.once('ready', () => { clearTimeout(timer); resolve(); });
        current.once('error', error => { clearTimeout(timer); reject(error); });
      });
      current.on('error', error => { if (this.watcher === current && this.state === 'running') this.fail(error instanceof Error ? error.message : String(error), current); });
      this.state = 'running';
      let checking = false;
      this.healthTimer = setInterval(() => {
        if (checking || this.state !== 'running' || this.watcher !== current) return;
        checking = true;
        void fs.stat(root).then(stat => {
          if (this.state === 'running' && this.watcher === current && (!stat.isDirectory() || stat.dev !== rootStat.dev || stat.ino !== rootStat.ino)) this.fail('Configured build directory was replaced', current);
        }).catch(error => {
          if (this.state === 'running' && this.watcher === current) this.fail((error as NodeJS.ErrnoException).code === 'ENOENT' ? 'Configured build directory was removed' : `Build directory check failed: ${error instanceof Error ? error.message : String(error)}`, current);
        }).finally(() => { checking = false; });
      }, 1000);
      this.healthTimer.unref?.();
      return this.status();
    } catch (error) {
      this.state = 'failed'; this.error = error instanceof Error ? error.message : String(error); this.watcher = null;
      if (watcher) await watcher.close();
      throw error;
    }
  }); }
  private fail(message: string, watcher: FSWatcher): void {
    this.state = 'failed'; this.error = message; this.flush(); this.watcher = null;
    if (this.healthTimer) clearInterval(this.healthTimer); this.healthTimer = null;
    this.closing = watcher.close().catch(error => { this.error = `${message}; close failed: ${error instanceof Error ? error.message : String(error)}`; throw error; });
    void this.closing.catch(() => {});
  }
  stop(): Promise<BuildFileWatchStatus> { return this.serial(async () => {
    if (this.state === 'stopped') return this.status();
    this.state = 'stopping'; const watcher = this.watcher; this.watcher = null;
    if (this.healthTimer) clearInterval(this.healthTimer); this.healthTimer = null;
    try { if (watcher) await watcher.close(); if (this.closing) await this.closing; this.closing = null; this.flush(); this.state = 'stopped'; this.error = null; }
    catch (error) { this.state = 'failed'; this.error = error instanceof Error ? error.message : String(error); throw error; }
    return this.status();
  }); }
}
