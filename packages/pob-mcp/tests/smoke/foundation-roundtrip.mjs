import { strict as assert } from 'node:assert';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { normalizeObservation } from '../../build/foundation/observation.js';
import { PoBLuaApiClient } from '../../build/pobLuaBridge.js';
import { gearedBuildXml, smokePoBSrc } from './pobSource.mjs';

const client = new PoBLuaApiClient({ cwd: smokePoBSrc(), cmd: process.env.POB_CMD,
  args: [resolve('lua/vanilla_stdio_bridge.lua')], env: { POB_API_STDIO: '0' }, timeoutMs: 60000 });
const observe = async () => normalizeObservation({
  tree: await client.getTree(), items: await client.getItems(), skills: await client.getSkills(),
  config: await client.getConfig(), stats: await client.getStats(['Life', 'EnergyShield', 'TotalDPS', 'CombinedDPS', 'MinionTotalDPS']),
});
try {
  await client.start();
  await client.loadBuildXml(await readFile(gearedBuildXml, 'utf8'), 'roundtrip');
  const baseline = await observe();
  const { xml: exported } = await client.unchangedItemsSnapshot();
  const afterExport = await observe();
  for (const section of Object.keys(baseline)) assert.deepEqual(afterExport[section], baseline[section], `export mutated ${section}`);
  await client.loadBuildXml(exported, 'roundtrip');
  const reloaded = await observe();
  const changed = Object.keys(baseline).filter(section => { try { assert.deepEqual(reloaded[section], baseline[section]); return false; } catch { return true; } });
  function differences(a, b, path = '') {
    if (Object.is(a, b)) return [];
    if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return [{path, before: a, after: b}];
    return [...new Set([...Object.keys(a), ...Object.keys(b)])].flatMap(key => differences(a[key], b[key], `${path}/${key}`));
  }
  for (const section of changed) {
    const diff = differences(baseline[section], reloaded[section], section);
    console.error(JSON.stringify({ section, count: diff.length, examples: diff.slice(0, 6) }));
  }
  assert.deepEqual(changed, [], `roundtrip changed: ${changed.join(', ')}`);
  console.log('geared build roundtrip observations passed');
} finally { await client.stop(); }
