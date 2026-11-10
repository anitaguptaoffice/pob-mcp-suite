import { mkdtemp, mkdir, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { LocalBuildFileWatcher } from '../../src/adapters/localBuild/fileWatcher.js';
import { createBuildWatchTools } from '../../src/features/localBuildWatch/tools.js';

async function waitFor(check: () => boolean) {
  const deadline = Date.now() + 10000;
  while (!check()) { if (Date.now() > deadline) throw new Error('Timed out waiting for watcher event'); await new Promise(resolve => setTimeout(resolve, 50)); }
}
describe('local build watcher', () => {
  it('records real nested changes, atomic replacement and bounded cursors without following symlinks', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'pob-watch-')), outside = await mkdtemp(path.join(tmpdir(), 'pob-watch-outside-'));
    const watch = new LocalBuildFileWatcher(root, 2, 100);
    try {
      await mkdir(path.join(root, 'league')); await mkdir(path.join(root, '.hidden'));
      await writeFile(path.join(root, 'existing.xml'), '<old/>'); await symlink(outside, path.join(root, 'linked'));
      expect((await watch.start()).state).toBe('running');
      expect(watch.changes(0, 100).events).toEqual([]);
      const target = path.join(root, 'league', 'build.xml');
      await writeFile(target, '<first/>'); await waitFor(() => watch.status().latestSequence >= 1);
      expect(watch.changes(0, 100).events[0]).toMatchObject({ path: path.join('league', 'build.xml'), type: 'added' });
      await writeFile(path.join(root, '.hidden', 'hidden.xml'), '<hidden/>'); await writeFile(path.join(outside, 'outside.xml'), '<outside/>');
      await symlink(path.join(outside, 'outside.xml'), path.join(root, 'shortcut.xml'));
      const replacement = path.join(root, 'league', '~~temp~~build'); await writeFile(replacement, '<second/>'); await rename(replacement, target);
      await waitFor(() => watch.status().latestSequence >= 2);
      expect(watch.changes(1, 100).events[0]).toMatchObject({ path: path.join('league', 'build.xml'), type: 'modified' });
      await rm(target); await waitFor(() => watch.status().latestSequence >= 3);
      const changes = watch.changes(0, 100);
      expect(changes.lostBefore).toBe(true); expect(changes.events.map(event => event.type)).toEqual(['modified', 'deleted']);
      expect(changes.events.every(event => event.path === path.join('league', 'build.xml'))).toBe(true);
      const tools = createBuildWatchTools(watch), list = tools[3];
      await expect(list.invoke({ after_sequence: 1 })).rejects.toThrow('cursor');
      await expect(list.invoke({ after_sequence: 1, session_id: 'wrong' })).rejects.toThrow('cursor');
      const page = JSON.parse((await list.invoke({ after_sequence: 1, session_id: watch.status().sessionId, limit: 1 })).content[0].text);
      expect(page.events[0].sequence).toBe(2); expect(page.nextSequence).toBe(2);
      expect((await watch.stop()).state).toBe('stopped');
    } finally { await watch.stop(); await rm(root, { recursive: true, force: true }); await rm(outside, { recursive: true, force: true }); }
  }, 30000);
  it('reports a missing directory as failed and serializes start and stop', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'pob-watch-start-')), dir = path.join(root, 'new');
    const watch = new LocalBuildFileWatcher(dir);
    try {
      await expect(watch.start()).rejects.toThrow(); expect(watch.status().state).toBe('failed');
      await mkdir(dir);
      const [started, stopped] = await Promise.all([watch.start(), watch.stop()]);
      expect(started.state).toBe('running'); expect(stopped.state).toBe('stopped');
    } finally { await watch.stop(); await rm(root, { recursive: true, force: true }); }
  });
  it('marks observation failed if the watched root is removed', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'pob-watch-removed-'));
    const watch = new LocalBuildFileWatcher(root);
    try {
      await watch.start(); await rm(root, { recursive: true, force: true });
      await waitFor(() => watch.status().state === 'failed');
      expect(watch.status().error).toContain('removed');
      expect((await watch.stop()).state).toBe('stopped');
    } finally { await watch.stop(); await rm(root, { recursive: true, force: true }); }
  }, 15000);
  it('detects a directory replaced at the same path', async () => {
    const parent = await mkdtemp(path.join(tmpdir(), 'pob-watch-replaced-')), root = path.join(parent, 'builds');
    await mkdir(root); const watch = new LocalBuildFileWatcher(root);
    try {
      await watch.start(); await rename(root, path.join(parent, 'old')); await mkdir(root);
      await waitFor(() => watch.status().state === 'failed');
      expect(watch.status().error).toMatch(/replaced|removed/);
    } finally { await watch.stop(); await rm(parent, { recursive: true, force: true }); }
  }, 15000);
});
