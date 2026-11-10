import { strict as assert } from 'node:assert';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { once } from 'node:events';
import { startMcpServer } from './mcpClient.mjs';
import { BuildExportService } from '../../build/services/buildExportService.js';

const dir = await mkdtemp(join(tmpdir(), 'pob-file-catalog-'));
const mcp = startMcpServer({ POB_FOUNDATION_ENABLED: 'true', POB_LEGACY_ENABLED: 'false', POB_DIRECTORY: dir, POB_SNAPSHOT_DIRECTORY: join(dir, '.snapshots'), POB_ADAPTER_PATH: resolve('lua/vanilla_stdio_bridge.lua') });
const child = mcp.child; child.stderr.on('data', () => {}); const exited = once(child, 'exit');
try {
  const xml = await readFile(resolve('example-build.xml'), 'utf8');
  await mkdir(join(dir, 'league')); await writeFile(join(dir, 'league', 'build.xml'), xml);
  const legacy = await new BuildExportService(dir).snapshotBuild({ buildName: 'league/build', tag: 'before', description: 'legacy history fixture' });
  await mcp.request('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'file-catalog-smoke', version: '1' } }); mcp.notify('notifications/initialized', {});
  const call = async (name, args) => { const response = await mcp.request('tools/call', { name, arguments: args }); assert.ok(!response.error && !response.result?.isError, JSON.stringify(response).slice(0, 1000)); return JSON.parse(response.result.content[0].text); };
  const history = await call('list_legacy_build_history', { build_name: 'league/build', tag: 'before' });
  assert.equal(history.complete, true); assert.equal(history.entries.length, 1);
  assert.equal(history.entries[0].id, legacy.snapshotId); assert.equal(history.entries[0].metadata.description, 'legacy history fixture');
  const importedHistory = await call('import_legacy_build_history', { build_name: 'league/build', origin: history.entries[0].origin, legacy_id: history.entries[0].id, metadata_digest: history.entries[0].metadataDigest });
  assert.equal(importedHistory.legacy.metadata.tag, 'before'); assert.equal(importedHistory.snapshot.parentId, null);
  assert.equal((await call('foundation_export_build', { snapshot_id: importedHistory.snapshot.id })).xml, xml);
  assert.equal(await readFile(legacy.snapshotPath, 'utf8'), xml);
  const catalog = await call('list_local_build_files', {});
  assert.equal(catalog.complete, true); assert.deepEqual(catalog.names, [join('league', 'build.xml')]);
  const snapshot = await call('foundation_import_file', { build_name: catalog.names[0] });
  const watch = await call('start_local_build_watch', {}); assert.equal(watch.state, 'running');
  await writeFile(join(dir, 'league', 'build.xml'), `${xml}\n`);
  const deadline = Date.now() + 15000; let changes;
  do { changes = await call('list_local_build_changes', { session_id: watch.sessionId }); if (changes.events.length) break; await new Promise(resolve => setTimeout(resolve, 100)); } while (Date.now() < deadline);
  assert.equal(changes.events[0]?.type, 'modified'); assert.equal(changes.events[0]?.path, catalog.names[0]);
  assert.equal((await call('foundation_export_build', { snapshot_id: snapshot.id })).xml, xml);
  const updated = await call('foundation_import_file', { build_name: catalog.names[0] });
  assert.notEqual(updated.id, snapshot.id); assert.equal((await call('foundation_export_build', { snapshot_id: updated.id })).xml, `${xml}\n`);
  assert.equal((await call('stop_local_build_watch', {})).state, 'stopped');
  child.stdin.end(); assert.equal((await exited)[0], 0); console.log('foundation file catalog passed');
} finally { if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM'); await rm(dir, { recursive: true, force: true }); }
