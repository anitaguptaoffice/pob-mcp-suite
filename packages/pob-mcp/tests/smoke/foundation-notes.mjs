import { strict as assert } from 'node:assert';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { once } from 'node:events';
import { PoBLuaApiClient } from '../../build/adapters/pob/bridge.js';
import { smokePoBSrc } from './pobSource.mjs';
import { startMcpServer } from './mcpClient.mjs';

const dir = await mkdtemp(join(tmpdir(), 'pob-notes-'));
const client = new PoBLuaApiClient({ cwd: smokePoBSrc(), cmd: process.env.POB_CMD, args: [resolve('lua/vanilla_stdio_bridge.lua')], env: { POB_API_STDIO: '0' }, timeoutMs: 60000 });
let child;
try {
  await client.start(); await client.newBuild({ className: 'Witch' });
  const xml = await client.exportBuildXml();
  await client.stop();
  const mcp = startMcpServer({ POB_FOUNDATION_ENABLED: 'true', POB_LEGACY_ENABLED: 'false', POB_DIRECTORY: dir, POB_SNAPSHOT_DIRECTORY: join(dir, 'snapshots'), POB_ADAPTER_PATH: resolve('lua/vanilla_stdio_bridge.lua') });
  child = mcp.child; child.stderr.on('data', () => {}); const exited = once(child, 'exit');
  await mcp.request('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'notes-smoke', version: '1' } });
  mcp.notify('notifications/initialized', {});
  const call = async (name, args) => {
    const response = await mcp.request('tools/call', { name, arguments: args });
    assert.ok(!response.error && !response.result?.isError, JSON.stringify(response));
    return JSON.parse(response.result.content[0].text);
  };
  const parent = await call('foundation_import_build', { xml, source: 'notes-fixture' });
  assert.equal((await call('foundation_read_notes', { snapshot_id: parent.id })).notes, '');
  const text = '构筑记录 & <装备> "quoted"\n第二行 😀 ^1colour\tend\r\nWindows\rlines';
  const derived = await call('foundation_derive_notes', { snapshot_id: parent.id, notes: text });
  assert.equal(derived.parentId, parent.id);
  assert.equal((await call('foundation_read_notes', { snapshot_id: derived.id })).notes, text);
  const appended = await call('foundation_derive_notes', { snapshot_id: derived.id, notes: 'additional & <notes>', mode: 'append' });
  assert.equal(appended.parentId, derived.id);
  const appendedText = `${text}\n\n---\n\nadditional & <notes>`;
  assert.equal((await call('foundation_read_notes', { snapshot_id: appended.id })).notes, appendedText);
  assert.equal((await call('foundation_read_notes', { snapshot_id: derived.id })).notes, text);
  const emptyBaseAppend = await call('foundation_derive_notes', { snapshot_id: parent.id, notes: 'first', mode: 'append' });
  assert.equal((await call('foundation_read_notes', { snapshot_id: emptyBaseAppend.id })).notes, 'first');
  const emptyAppend = await call('foundation_derive_notes', { snapshot_id: derived.id, notes: '', mode: 'append' });
  assert.equal((await call('foundation_read_notes', { snapshot_id: emptyAppend.id })).notes, text);
  const comparison = await call('compare_snapshot_builds', { baseline_snapshot_id: parent.id, candidate_snapshot_id: derived.id, fields: ['Life'] });
  assert.equal(comparison.metrics.Life.delta, 0);
  assert.equal(comparison.comparability.configDifferent, false);
  const saved = await call('foundation_save_file', { snapshot_id: appended.id, build_name: '.pob-mcp/exports/new/notes-workflow', create_directories: true });
  assert.equal(saved.retained, true);
  assert.equal(saved.directoriesAllowed, true);
  const duplicate = await mcp.request('tools/call', { name: 'foundation_save_file', arguments: { snapshot_id: appended.id, build_name: '.pob-mcp/exports/new/notes-workflow', create_directories: true } });
  assert.equal(duplicate.result.isError, true);
  const fileImport = await call('foundation_import_file', { build_name: '.pob-mcp/exports/new/notes-workflow' });
  assert.equal((await call('foundation_read_notes', { snapshot_id: fileImport.id })).notes, appendedText);
  const exported = (await call('foundation_export_build', { snapshot_id: derived.id })).xml;
  const reimported = await call('foundation_import_build', { xml: exported, source: 'notes-reloaded' });
  assert.equal((await call('foundation_read_notes', { snapshot_id: reimported.id })).notes, text);
  assert.equal((await call('foundation_read_notes', { snapshot_id: parent.id })).notes, '');
  assert.equal((await call('foundation_export_build', { snapshot_id: parent.id })).xml, xml);
  const cleared = await call('foundation_derive_notes', { snapshot_id: derived.id, notes: '' });
  assert.equal((await call('foundation_read_notes', { snapshot_id: cleared.id })).notes, '');
  for (const notes of ['bad\u0000xml', '\ud800', 'x'.repeat(512 * 1024 + 1)]) {
    const invalid = await mcp.request('tools/call', { name: 'foundation_derive_notes', arguments: { snapshot_id: parent.id, notes } });
    assert.equal(invalid.result?.isError, true, JSON.stringify(invalid));
  }
  child.stdin.end(); assert.equal((await exited)[0], 0);
  console.log('foundation notes roundtrip passed');
} finally {
  if (child && child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
  await client.stop(); await rm(dir, { recursive: true, force: true });
}
