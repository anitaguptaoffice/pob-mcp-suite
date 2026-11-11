import { strict as assert } from 'node:assert';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { smokePoBSrc } from './pobSource.mjs';
import { startMcpServer } from './mcpClient.mjs';

const src = smokePoBSrc();
const dir = await mkdtemp(join(tmpdir(), 'pob-modifier-data-'));
const mcp = startMcpServer({ POE_TRADE_ENABLED: 'false', POB_PATH: src, POB_DIRECTORY: dir, POB_SNAPSHOT_DIRECTORY: join(dir, 'snapshots') });
const child = mcp.child; child.stderr.on('data', () => {}); const exited = once(child, 'exit');
try {
  await mcp.request('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'modifier-data-smoke', version: '1' } }); mcp.notify('notifications/initialized', {});
  const names = (await mcp.request('tools/list', {})).result.tools.map(tool => tool.name);
  for (const name of ['classify_modifier_lines', 'query_bench_modifiers', 'query_modifier_tiers', 'foundation_import_build']) assert.ok(names.includes(name));
  assert.ok(!names.includes('search_official_trade'));
  const hiddenTrade = await mcp.request('tools/call', { name: 'search_official_trade', arguments: { league: 'Standard' } });
  assert.equal(hiddenTrade.result.isError, true);
  const call = async (name, args) => { const response = await mcp.request('tools/call', { name, arguments: args }); assert.ok(!response.error && !response.result?.isError, JSON.stringify(response).slice(0, 1000)); return JSON.parse(response.result.content[0].text); };
  const tiers = await call('query_modifier_tiers', { search: 'maximum Life', item_tags: ['ring', 'default'], item_tags_complete: true, limit: 3 });
  assert.ok(tiers.groups.length > 0);
  assert.ok(tiers.groups.flatMap(group => group.tiers).every(tier => tier.firstMatchingBaseRule));
  const file = await readFile(join(src, 'Data', tiers.source.fileName));
  assert.equal(tiers.source.sha256, createHash('sha256').update(file).digest('hex'));
  const bench = await call('query_bench_modifiers', { item_class: 'Body Armour', item_level: 45, affix_type: 'Suffix', search: 'Fire Resistance', limit: 2 });
  assert.ok(bench.withinItemLevel > 0 && bench.lockedByItemLevel > 0);
  assert.ok(bench.total > bench.mods.length && bench.nextOffset === 2);
  const classified = await call('classify_modifier_lines', { mod_lines: ['+33% to Chaos Resistance'] });
  assert.equal(classified.resolution.openPrefixes, null); assert.equal(classified.resolution.openSuffixes, null);
  assert.ok(classified.resolution.affixes.length > 0); assert.equal(classified.source.length, 2);
  const invalid = await mcp.request('tools/call', { name: 'query_modifier_tiers', arguments: { search: 'Life', item_tags: ['ring'], item_tags_complete: true } });
  assert.equal(invalid.result.isError, true);
  child.stdin.end(); assert.equal((await exited)[0], 0); console.log('independent modifier data passed');
} finally {
  if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
  await rm(dir, { recursive: true, force: true });
}
