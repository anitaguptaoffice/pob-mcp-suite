// Deep end-to-end MCP smoke test: full tool surface against an unmodified PoB.
// Usage: node tests/smoke/mcp-full.mjs   (set POB_PATH only to force a checkout)
import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { startMcpServer } from './mcpClient.mjs';
import { smokePoBSrc } from './pobSource.mjs';

// The server resolves the engine itself; fail here so a missing PoB reads as
// a missing PoB rather than as a tool call timing out.
smokePoBSrc();
const buildsDir = await mkdtemp(join(tmpdir(), 'pob-mcp-full-'));
await cp(resolve('example-build.xml'), join(buildsDir, 'example.xml'));
await cp(resolve('example-build.xml'), join(buildsDir, 'other.xml'));
await cp(resolve('tests/fixtures/occ-vortex.xml'), join(buildsDir, 'vortex.xml'));
const { child, request, notify } = startMcpServer({ POB_DIRECTORY: buildsDir });
const call = async (name, args = {}) => {
  const response = await request('tools/call', { name, arguments: args });
  if (response.error || response.result?.isError) throw new Error(`${name} failed: ${JSON.stringify(response.error ?? response.result)}`);
  return response.result?.content?.[0]?.text || '';
};

try {
  await request('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'full-smoke', version: '1.0' } });
  notify('notifications/initialized', {});
  const listed = await request('tools/list', {});
  const names = new Set(listed.result.tools.map((tool) => tool.name));
  for (const name of ['lua_start', 'lua_load_build', 'lua_get_build_snapshot', 'set_character_level', 'lua_set_tree', 'list_specs', 'select_spec', 'suggest_masteries', 'add_item', 'get_equipped_items']) {
    if (!names.has(name)) throw new Error(`missing MCP tool: ${name}`);
  }

  const rejected = await request('tools/call', { name: 'not_a_real_tool', arguments: {} });
  if (rejected.result?.isError !== true) throw new Error(`MCP errors must set isError: ${JSON.stringify(rejected)}`);

  await call('lua_start');
  await call('lua_new_build', { class_name: 'Witch' });
  const partialGems = await request('tools/call', { name: 'setup_skill_with_gems', arguments: {
    label: 'Partial test', active_gem: 'Arc', support_gems: ['Not A Real Gem', 'Efficacy'], slot: 'Helmet',
  } });
  const partialGemsText = partialGems.result?.content?.[0]?.text ?? '';
  if (!partialGems.result?.isError || !partialGemsText.includes('Socket group 1 was created') ||
      !partialGemsText.includes('Arc (L20, Q0)') || !partialGemsText.includes('Gems not attempted: 1')) {
    throw new Error(`partial skill setup was not reported: ${JSON.stringify(partialGems)}`);
  }
  await call('lua_new_build', { class_name: 'Witch' });
  const partialBatch = await request('tools/call', { name: 'add_multiple_items', arguments: { items: [
    { item_text: 'Rarity: RARE\nBatch Test\nGold Ring\nItem Level: 86\nImplicits: 0', slot_name: 'Ring 1' },
    { item_text: 'Rarity: RARE\nBatch Test 2\nGold Ring\nItem Level: 86\nImplicits: 0', slot_name: 'Not A Slot' },
    { item_text: 'Rarity: RARE\nBatch Test 3\nGold Ring\nItem Level: 86\nImplicits: 0', slot_name: 'Ring 2' },
  ] } });
  const partialText = partialBatch.result?.content?.[0]?.text ?? '';
  if (!partialBatch.result?.isError || !partialText.includes('Completed before failure: 1') || !partialText.includes('Items not attempted: 1') || !partialText.includes('Ring 1')) {
    throw new Error(`batch partial state was not reported: ${JSON.stringify(partialBatch)}`);
  }
  await call('lua_new_build', { class_name: 'Witch' });
  await call('create_socket_group', { label: 'Smoke Gems', slot: 'Body Armour' });
  const beforeInvalidGem = await call('get_skill_setup');
  const invalidGem = await request('tools/call', { name: 'add_gem', arguments: { group_index: 1, gem_name: 'Not A Real Gem' } });
  if (!invalidGem.result?.isError || !JSON.stringify(invalidGem).includes('unrecognized gem')) throw new Error(`invalid gem was not rejected: ${JSON.stringify(invalidGem)}`);
  if (await call('get_skill_setup') !== beforeInvalidGem) throw new Error('invalid gem changed the current build');
  await call('add_gem', { group_index: 1, gem_name: 'Fireball', level: 1, quality: 0 });
  await call('set_gem_level', { group_index: 1, gem_index: 1, level: 2 });
  await call('set_gem_quality', { group_index: 1, gem_index: 1, quality: 5 });
  const editedSkills = await call('get_skill_setup');
  if (!editedSkills.includes('Fireball (2/5)')) throw new Error(`gem edit workflow was incomplete: ${editedSkills}`);
  await call('remove_gem', { group_index: 1, gem_index: 1 });
  await call('remove_skill', { group_index: 1 });
  const buildList = await call('list_builds');
  if (!buildList.includes('example.xml')) throw new Error(`build discovery was incomplete: ${buildList}`);
  const buildStats = await call('get_build_stats', { build_name: 'example.xml' });
  if (!buildStats.includes('=== Stats for example.xml ===')) throw new Error(`file build stats were incomplete: ${buildStats}`);
  await call('set_build_notes', { build_name: 'example.xml', notes: 'MCP smoke note' });
  const notes = await call('get_build_notes', { build_name: 'example.xml' });
  if (!notes.includes('MCP smoke note')) throw new Error(`build notes were not persisted: ${notes}`);
  await call('lua_load_build', { build_name: 'example.xml' });
  const before = await call('lua_get_build_snapshot');
  if (!before.includes('Level 90')) throw new Error(`unexpected initial snapshot: ${before}`);
  await call('set_character_level', { level: 89 });
  const changed = await call('lua_get_build_snapshot');
  if (!changed.includes('Level 89')) throw new Error(`snapshot did not reflect level edit: ${changed}`);
  const otherAnalysis = await call('analyze_build', { build_name: 'other.xml' });
  if (!otherAnalysis.includes('Live Calculated Stats') || !otherAnalysis.includes('isolated engine')) throw new Error(`isolated live analysis failed: ${otherAnalysis}`);
  const afterAnalysis = await call('lua_get_build_snapshot');
  if (!afterAnalysis.includes('Level 89')) throw new Error(`analysis overwrote unsaved changes: ${afterAnalysis}`);
  const supportCandidates = JSON.parse(await call('suggest_support_gems', { build_name: 'vortex.xml', query: 'Efficacy' }));
  if (supportCandidates.source !== 'saved_build_isolated_pob' || !supportCandidates.candidates.some(g => g.name === 'Efficacy')) throw new Error(`compatible support lookup failed: ${JSON.stringify(supportCandidates)}`);
  if (!(await call('lua_get_build_snapshot')).includes('Level 89')) throw new Error('support lookup overwrote unsaved changes');
  const gemComparison = JSON.parse(await call('compare_gem_setups', { build_name: 'vortex.xml', setups: [
    { name: 'efficacy', gems: ['Vortex', 'Efficacy'], gem_overrides: { Vortex: { level: 20 } } },
    { name: 'controlled', gems: ['Vortex', 'Controlled Destruction'] },
  ] }));
  if (gemComparison.source !== 'saved_build_isolated_pob' || gemComparison.setups.length !== 2) throw new Error(`gem comparison was incomplete: ${JSON.stringify(gemComparison)}`);
  if (gemComparison.setups[0].gems.find(gem => gem.name === 'Vortex')?.level !== 20) throw new Error(`gem level override was not applied: ${JSON.stringify(gemComparison)}`);
  const afterGemComparison = await call('lua_get_build_snapshot');
  if (!afterGemComparison.includes('Level 89')) throw new Error(`gem comparison overwrote unsaved changes: ${afterGemComparison}`);
  const rankedSupports = JSON.parse(await call('rank_support_gems', { build_name: 'vortex.xml', replace_gem: 'Hypothermia', candidates: ['Hypothermia', 'Added Cold Damage'], damage_metric: 'CombinedDPS' }));
  if (rankedSupports.metric !== 'CombinedDPS' || rankedSupports.ranked.find(g => g.gem === 'Hypothermia')?.delta !== 0) throw new Error(`support ranking was incomplete: ${JSON.stringify(rankedSupports)}`);
  if (!(await call('lua_get_build_snapshot')).includes('Level 89')) throw new Error('support ranking overwrote unsaved changes');
  const otherDefenses = await call('analyze_defenses', { build_name: 'other.xml' });
  if (!otherDefenses.includes('Defensive Analysis') || !otherDefenses.includes('isolated engine')) throw new Error(`isolated defence analysis failed: ${otherDefenses}`);
  const otherItems = await call('analyze_items', { build_name: 'other.xml' });
  if (!otherItems.includes('Item Upgrade Analysis') || !otherItems.includes('独立引擎')) throw new Error(`isolated item analysis failed: ${otherItems}`);
  const otherSkills = await call('optimize_skill_links', { build_name: 'other.xml' });
  if (!otherSkills.includes('独立引擎')) throw new Error(`isolated skill analysis failed: ${otherSkills}`);
  const otherGems = await call('gem_upgrade_path', { build_name: 'other.xml' });
  if (!otherGems.includes('独立引擎') || !otherGems.includes('不计算升级收益')) throw new Error(`isolated gem inspection failed: ${otherGems}`);
  const otherNodes = await call('suggest_optimal_nodes', { build_name: 'other.xml', goal: 'life', points_available: 2 });
  if (!otherNodes.includes('isolated engine')) throw new Error(`isolated node analysis failed: ${otherNodes}`);
  const otherTree = await call('optimize_tree', { build_name: 'other.xml', goal: 'balanced', max_points: 2 });
  if (!otherTree.includes('isolated engine')) throw new Error(`isolated tree analysis failed: ${otherTree}`);
  const afterOptimization = await call('lua_get_build_snapshot');
  if (!afterOptimization.includes('Level 89')) throw new Error(`optimization overwrote unsaved changes: ${afterOptimization}`);
  const comparison = await call('compare_builds', { build1: 'example.xml', build2: 'example.xml' });
  if (!comparison.includes('Build Comparison (Live Stats)') || !comparison.includes('isolated engine')) throw new Error(`isolated live comparison failed: ${comparison}`);
  const afterComparison = await call('lua_get_build_snapshot');
  if (!afterComparison.includes('Level 89')) throw new Error(`comparison overwrote unsaved changes: ${afterComparison}`);
  await call('validate_build', { build_name: 'example.xml' });
  const afterValidation = await call('lua_get_build_snapshot');
  if (!afterValidation.includes('Level 89')) throw new Error(`validation overwrote unsaved changes: ${afterValidation}`);
  await call('set_character_level', { level: 90 });
  const restored = await call('lua_get_build_snapshot');
  if (!restored.includes('Level 90')) throw new Error(`snapshot did not reflect level restoration: ${restored}`);
  const specs = await call('list_specs');
  if (!specs.includes('[1] Main Build')) throw new Error(`spec listing was incomplete: ${specs}`);
  await call('select_spec', { index: 1 });
  const skills = await call('get_skill_setup');
  if (!skills.includes('Skill Setup')) throw new Error(`skill setup was incomplete: ${skills}`);
  const nodeSearch = await call('search_tree_nodes', { query: 'life', limit: 3 });
  if (!nodeSearch.includes('Passive Tree Node Search')) throw new Error(`tree search was incomplete: ${nodeSearch}`);
  const masteries = await call('suggest_masteries', {});
  if (!masteries.includes('Mastery Suggestions')) throw new Error(`mastery suggestion response was incomplete: ${masteries}`);
  const issues = await call('get_build_issues');
  if (!issues.includes('Build Issues')) throw new Error(`build issue analysis was incomplete: ${issues}`);
  const validation = await call('validate_build', { build_name: 'example.xml' });
  if (!validation.includes('Build Validation')) throw new Error(`build validation was incomplete: ${validation}`);
  const defenses = await call('analyze_defenses', { build_name: 'example.xml' });
  if (!defenses.includes('Defensive Analysis')) throw new Error(`defence analysis was incomplete: ${defenses}`);
  const config = await call('get_config');
  if (!config.includes('Configuration')) throw new Error(`config retrieval was incomplete: ${config}`);
  await call('save_config_preset', { name: 'smoke' });
  const presets = await call('list_config_presets');
  if (!presets.includes('smoke')) throw new Error(`config preset was not persisted: ${presets}`);
  await call('load_config_preset', { name: 'smoke' });
  const snapshot = await call('snapshot_build', { build_name: 'example.xml', tag: 'smoke' });
  const snapshotId = snapshot.match(/Snapshot ID: ([^\n]+)/)?.[1];
  if (!snapshotId) throw new Error(`snapshot did not return an ID: ${snapshot}`);
  const snapshots = await call('list_snapshots', { build_name: 'example.xml', tag_filter: 'smoke' });
  if (!snapshots.includes(snapshotId)) throw new Error(`snapshot listing omitted the new snapshot: ${snapshots}`);
  await call('restore_snapshot', { build_name: 'example.xml', snapshot_id: snapshotId, backup_current: false });
  const boss = await call('check_boss_readiness', { boss: 'shaper' });
  if (!boss.includes('Boss Readiness: The Shaper')) throw new Error(`boss readiness was incomplete: ${boss}`);
  console.log('full MCP smoke passed: blank-build gem editing, file/build persistence, load, snapshot, level edit/restore, specs, skills/tree search, mastery/issue/defence analysis, validation, configuration presets, and boss readiness all succeeded');
} finally {
  child.kill();
  await rm(buildsDir, { recursive: true, force: true });
}
