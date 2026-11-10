import { strict as assert } from 'node:assert';
import { mkdtemp, mkdir, readFile, rm, access, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { once } from 'node:events';
import { deflateSync } from 'node:zlib';
import { startMcpServer } from './mcpClient.mjs';
import { JobStore } from '../../build/foundation/jobStore.js';
import { gearedBuildXml } from './pobSource.mjs';
const dir = await mkdtemp(join(tmpdir(), 'pob-foundation-mcp-'));
const { child, request, notify } = startMcpServer({ POB_FOUNDATION_ENABLED: 'true', POB_SNAPSHOT_DIRECTORY: dir, POB_DIRECTORY: dir,
  POB_ADAPTER_PATH: resolve('lua/vanilla_stdio_bridge.lua') });
child.stderr.on('data', () => {});
const childExit = once(child, 'exit');
const call = async (name, args) => {
  const response = await request('tools/call', { name, arguments: args });
  assert.ok(!response.error && !response.result?.isError, JSON.stringify(response));
  return JSON.parse(response.result.content[0].text);
};
try {
  await request('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'foundation-smoke', version: '1' } });
  notify('notifications/initialized', {});
  const listed = await request('tools/list', {});
  for (const name of ['foundation_import_build', 'foundation_import_code', 'foundation_evaluate', 'foundation_derive_level', 'foundation_export_build']) {
    assert.ok(listed.result.tools.some(tool => tool.name === name), name);
  }
  const xml = await readFile(resolve('example-build.xml'), 'utf8');
  await writeFile(join(dir, 'example.xml'), xml);
  await mkdir(join(dir, 'league')); await writeFile(join(dir, 'league', 'nested.xml'), xml);
  const files = await call('list_local_build_files', { limit: 100 });
  assert.ok(files.complete && files.names.includes('example.xml') && files.names.includes(join('league', 'nested.xml')));
  const nested = await call('foundation_import_file', { build_name: join('league', 'nested.xml') });
  assert.equal((await call('foundation_export_build', { snapshot_id: nested.id })).xml, xml);
  const fromFile = await call('foundation_import_file', { build_name: 'example' });
  await writeFile(join(dir, 'example.xml'), '<changed/>');
  assert.equal((await call('foundation_export_build', { snapshot_id: fromFile.id })).xml, xml);
  const imported = await call('foundation_import_build', { xml, source: 'fixture' });
  const fromCode = await call('foundation_import_code', { code: deflateSync(xml).toString('base64url') });
  assert.equal((await call('foundation_export_build', { snapshot_id: fromCode.id })).xml, xml);
  assert.equal('xml' in imported, false);
  assert.match(imported.executableVersion, /^sha256:[a-f0-9]{64}$/);
  assert.match(imported.dataVersion, /^pob-src:sha256:[a-f0-9]{64}$/);
  assert.equal((await call('foundation_read_snapshot', { snapshot_id: imported.id })).id, imported.id);
  const inspected = await call('foundation_inspect', { snapshot_id: imported.id, sections: ['build', 'tree', 'items', 'skills', 'config'] });
  assert.equal(inspected.snapshotId, imported.id);
  assert.ok(Array.isArray(inspected.data.tree.nodes));
  assert.ok(Array.isArray(inspected.data.items));
  assert.ok(Array.isArray(inspected.data.skills.groups));
  assert.ok(inspected.data.config && inspected.data.build);
  const treeSearch = await call('foundation_search_tree', { snapshot_id: imported.id, query: 'life', limit: 3 });
  assert.equal(treeSearch.treeVersion, inspected.data.tree.treeVersion ?? null);
  assert.ok(treeSearch.nodes.length > 0 && treeSearch.nodes.length <= 3);
  assert.equal(treeSearch.returnedCount, treeSearch.nodes.length);
  assert.ok(treeSearch.nodes.every(node => node.allocated === false));
  const geared = await call('foundation_import_build', { xml: await readFile(gearedBuildXml, 'utf8'), source: 'geared-fixture' });
  const gearedTree = await call('foundation_inspect', { snapshot_id: geared.id, sections: ['tree'] });
  const nodeCandidates = await call('foundation_search_tree', { snapshot_id: geared.id, query: 'life', node_type: 'notable', limit: 30 });
  const node = nodeCandidates.nodes.find(candidate => !candidate.isBlighted && Array.isArray(candidate.pathNodes) && candidate.pathNodes.length > 0 && candidate.pathNodes.includes(candidate.id));
  assert.ok(node, 'fixture needs a reachable life notable');
  const treeVersion = await call('foundation_derive_tree', { snapshot_id: geared.id, add_nodes: node.pathNodes });
  const changedTree = await call('foundation_inspect', { snapshot_id: treeVersion.id, sections: ['tree'] });
  assert.ok(node.pathNodes.every(id => changedTree.data.tree.nodes.includes(id)));
  const treeDifference = await call('compare_snapshot_trees', { baseline_snapshot_id: geared.id, candidate_snapshot_id: treeVersion.id });
  assert.deepEqual(treeDifference.nodesAdded, [...node.pathNodes].sort((a, b) => a - b));
  assert.deepEqual(treeDifference.nodesRemoved, []);
  assert.equal(treeDifference.treeVersion, gearedTree.data.tree.treeVersion);
  assert.equal(treeVersion.parentId, geared.id);
  const restoredTreeVersion = await call('foundation_derive_tree', { snapshot_id: treeVersion.id, remove_nodes: node.pathNodes });
  const restoredTree = await call('foundation_inspect', { snapshot_id: restoredTreeVersion.id, sections: ['tree'] });
  assert.deepEqual(restoredTree.data.tree, gearedTree.data.tree);

  assert.deepEqual((await call('foundation_inspect', { snapshot_id: geared.id, sections: ['tree'] })).data.tree, gearedTree.data.tree);

  const supports = await call('foundation_compatible_supports', { snapshot_id: geared.id, group_index: 5, query: 'Efficacy' });
  assert.equal(supports.groupIndex, 5);
  assert.ok(supports.candidates.some(candidate => candidate.name === 'Efficacy'));
  assert.equal(typeof supports.failed, 'number');
  const incompatible = await call('foundation_compatible_supports', { snapshot_id: geared.id, group_index: 5, query: 'Minion Damage' });
  assert.equal(incompatible.candidates.some(candidate => candidate.name === 'Minion Damage'), false);
  const weightArgs = { snapshot_id: imported.id, mod_id: 'AddedPhysicalDamage7' };
  const amuletWeight = await call('foundation_item_affix_weight', { ...weightArgs, item_text: 'Rarity: RARE\nWeight Test\nCitrine Amulet\nItem Level: 1\nImplicits: 0' });
  const ringWeight = await call('foundation_item_affix_weight', { ...weightArgs, item_text: 'Rarity: RARE\nWeight Test\nGold Ring\nItem Level: 86\nImplicits: 0' });
  assert.equal(amuletWeight.weight, 1000);
  assert.equal(ringWeight.weight, 0);
  assert.equal(amuletWeight.itemLevelAllows, false);
  assert.ok(amuletWeight.warnings.some(warning => warning.includes('not a crafting probability')));




  const firstPage = await call('foundation_list_snapshots', { limit: 1 });
  assert.equal(firstPage.snapshots.length, 1);
  assert.ok(firstPage.nextCursor);
  const nextPage = await call('foundation_list_snapshots', { limit: 1, after: firstPage.nextCursor });
  assert.equal(nextPage.snapshots.length, 1);
  assert.notEqual(firstPage.snapshots[0].id, nextPage.snapshots[0].id);
  const baseline = await call('foundation_evaluate', { snapshot_id: imported.id, fields: ['Life', 'NonexistentMetric'] });
  assert.equal(baseline.metrics.Life.status, 'available');
  assert.equal(baseline.metrics.NonexistentMetric.status, 'unknown');
  assert.ok(baseline.context.skills && baseline.context.config);
  const configured = await call('foundation_evaluate', { snapshot_id: imported.id, fields: ['Life'], selection: { mainSocketGroup: 1 }, config: { enemyIsBoss: 'Pinnacle' } });
  assert.equal(configured.context.config.enemyIsBoss, 'Pinnacle');
  assert.equal(configured.context.skills.mainSocketGroup, 1);
  const again = await call('foundation_evaluate', { snapshot_id: imported.id, fields: ['Life'] });
  assert.deepEqual(again.stats.Life, baseline.stats.Life);
  assert.deepEqual(again.context.config, baseline.context.config);
  const configVersion = await call('foundation_derive_config', { snapshot_id: imported.id, config: { enemyIsBoss: 'Pinnacle' } });
  assert.equal(configVersion.parentId, imported.id);
  const configState = await call('foundation_inspect', { snapshot_id: configVersion.id, sections: ['config'] });
  assert.equal(configState.data.config.enemyIsBoss, 'Pinnacle');
  const parentState = await call('foundation_inspect', { snapshot_id: imported.id, sections: ['config'] });
  assert.deepEqual(parentState.data.config, baseline.context.config);


  const derived = await call('foundation_derive_level', { snapshot_id: imported.id, level: 50 });
  const changed = await call('foundation_evaluate', { snapshot_id: derived.id, fields: ['Life'] });
  assert.notEqual(baseline.stats.Life, changed.stats.Life);
  const comparison = await call('compare_snapshot_builds', { baseline_snapshot_id: imported.id, candidate_snapshot_id: derived.id, fields: ['Life', 'NonexistentMetric'] });
  assert.equal(comparison.baseline.snapshotId, imported.id);
  assert.equal(comparison.candidate.snapshotId, derived.id);
  assert.equal(comparison.metrics.Life.delta, changed.metrics.Life.value - baseline.metrics.Life.value);
  assert.equal(comparison.metrics.NonexistentMetric.status, 'unavailable');
  assert.equal(comparison.comparability.configDifferent, false);
  assert.equal(comparison.comparability.treeVersionStatus, 'same');
  assert.deepEqual(comparison.baseline.context.config, baseline.context.config);
  const exported = await call('foundation_export_build', { snapshot_id: derived.id });
  await call('foundation_save_file', { snapshot_id: derived.id, build_name: 'saved' });
  const duplicate = await request('tools/call', { name: 'foundation_save_file', arguments: { snapshot_id: imported.id, build_name: 'saved' } });
  assert.equal(duplicate.result.isError, true);
  assert.equal(await readFile(join(dir, 'saved.xml'), 'utf8'), exported.xml);
  const saved = await call('foundation_import_file', { build_name: 'saved' });
  assert.equal((await call('foundation_export_build', { snapshot_id: saved.id })).xml, exported.xml);

  const reimport = await call('foundation_import_build', { xml: exported.xml, source: 'reload' });
  assert.deepEqual((await call('foundation_evaluate', { snapshot_id: reimport.id, fields: ['Life'] })).stats, changed.stats);
  const submitted = await call('foundation_submit_evaluations', { items: [
    { snapshotId: imported.id, fields: ['Life'], options: { selection: { mainSocketGroup: 1 }, config: { enemyIsBoss: 'Pinnacle' } } },
    { snapshotId: '0'.repeat(64), fields: ['Life'] },
  ] });
  let job;
  const deadline = Date.now() + 60000;
  do {
    job = await call('foundation_get_job', { job_id: submitted.id });
    if (['completed', 'failed', 'cancelled', 'interrupted'].includes(job.status)) break;
    await new Promise(resolve => setTimeout(resolve, 200));
  } while (Date.now() < deadline);
  assert.equal(job.status, 'completed');
  assert.equal(job.items[0].status, 'completed');
  assert.equal(job.items[0].result.stats.Life, baseline.stats.Life);
  assert.equal(job.items[0].result.context.config.enemyIsBoss, 'Pinnacle');
  assert.equal(job.items[0].result.context.skills.mainSocketGroup, 1);
  assert.equal(job.items[1].status, 'failed');
  const cancelled = await call('foundation_submit_evaluations', { items: [
    { snapshotId: imported.id, fields: ['Life'] }, { snapshotId: imported.id, fields: ['Life'] },
  ] });
  const cancelDeadline = Date.now() + 60000;
  let active;
  do {
    active = await call('foundation_get_job', { job_id: cancelled.id });
    if (active.items[0].status === 'running') break;
    await new Promise(resolve => setTimeout(resolve, 50));
  } while (Date.now() < cancelDeadline);
  assert.equal(active.items[0].status, 'running');
  const requested = await call('foundation_cancel_job', { job_id: cancelled.id });
  assert.equal(requested.status, 'cancel_requested');
  do {
    active = await call('foundation_get_job', { job_id: cancelled.id });
    if (active.status === 'cancelled') break;
    await new Promise(resolve => setTimeout(resolve, 100));
  } while (Date.now() < cancelDeadline);
  assert.equal(active.status, 'cancelled');
  assert.equal(active.items[0].status, 'completed');
  assert.equal(active.items[1].status, 'pending');


  const shutdownJob = await call('foundation_submit_evaluations', { items: [
    { snapshotId: imported.id, fields: ['Life'] }, { snapshotId: imported.id, fields: ['Life'] },
  ] });
  const shutdownDeadline = Date.now() + 60000;
  do {
    active = await call('foundation_get_job', { job_id: shutdownJob.id });
    if (active.items[0].status === 'running') break;
    await new Promise(resolve => setTimeout(resolve, 50));
  } while (Date.now() < shutdownDeadline);
  assert.equal(active.items[0].status, 'running');
  child.stdin.end();
  await access(join(dir, '.writer.lock'));
  const competitor = startMcpServer({ POB_FOUNDATION_ENABLED: 'true', POB_SNAPSHOT_DIRECTORY: dir });
  competitor.child.stderr.on('data', () => {});
const childExit = once(child, 'exit');
  const [competitorCode] = await once(competitor.child, 'exit');
  assert.notEqual(competitorCode, 0, 'second writer must not start during shutdown');
  const [code] = await childExit;
  const stopped = await new JobStore(join(dir, 'jobs')).get(shutdownJob.id);
  assert.equal(stopped.status, 'cancelled');
  assert.equal(stopped.items[0].status, 'completed');
  assert.equal(stopped.items[1].status, 'pending');
  assert.equal(code, 0);
  await assert.rejects(access(join(dir, '.writer.lock')));
  console.log('foundation MCP vertical slice passed');
} finally {
  if (child.exitCode === null && child.signalCode === null) { child.kill('SIGTERM'); await childExit; }
  await rm(dir, { recursive: true, force: true });
}
