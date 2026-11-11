import type { PoBLuaApiClient } from '../../adapters/pob/bridge.js';
import { readNamedBuild } from '../../utils/namedBuild.js';
import { resolveBuildFile } from '../../utils/pathSanitizer.js';
import { compareGemSetups } from '../gemComparison/compare.js';

const metrics = ['CombinedDPS', 'TotalDPS', 'MinionCombinedDPS', 'MinionTotalDPS'] as const;
type Metric = typeof metrics[number];
interface Context {
  pobDirectory?: string;
  createIsolatedLuaClient?: () => Promise<{ client: PoBLuaApiClient; close: () => Promise<void> }>;
}
interface Args { build_name: string; replace_gem: string; candidates: string[]; damage_metric?: Metric }
const normal = (s: string) => s.trim().toLowerCase();

/** Measure explicit replacement candidates using the saved build and PoB. */
export async function rankSupportGems(context: Context, args: Args) {
  if (!args.build_name || !context.pobDirectory || !context.createIsolatedLuaClient) throw new Error('build_name and an isolated PoB engine are required');
  if (typeof args.replace_gem !== 'string' || !args.replace_gem.trim() || !Array.isArray(args.candidates) ||
      args.candidates.length < 1 || args.candidates.length > 4 || args.candidates.some(name => typeof name !== 'string' || !name.trim()) ||
      new Set(args.candidates.map(normal)).size !== args.candidates.length) throw new Error('provide one support to replace and 1–4 distinct candidate names');
  if (args.damage_metric !== undefined && !metrics.includes(args.damage_metric)) throw new Error('invalid damage_metric');
  const xml = await readNamedBuild(args.build_name, context.pobDirectory);
  const path = resolveBuildFile(args.build_name, context.pobDirectory);
  const probe = await context.createIsolatedLuaClient();
  let original: string[];
  try {
    await probe.client.loadBuildXml(xml, args.build_name.replace(/\.xml$/i, ''), path);
    const skills = await probe.client.getSkills();
    const group = skills.groups.find(g => g.index === skills.mainSocketGroup);
    if (!group || group.enabled === false || group.gems.some(gem => !gem.enabled)) throw new Error('saved main group is missing, disabled, or contains disabled gems');
    if (group.slotEnabled !== true) throw new Error(group.slotEnabled === false
      ? 'saved main skill group belongs to an inactive equipment slot' : 'saved main skill group equipment-slot state is unknown');
    if (group.gems.length > 6 || new Set(group.gems.map(g => normal(g.name))).size !== group.gems.length) throw new Error('saved main group has too many or ambiguous gems');
    const replacement = group.gems.find(g => normal(g.name) === normal(args.replace_gem));
    if (!replacement?.isSupport) throw new Error('replace_gem must identify an enabled support in the saved main group');
    original = group.gems.map(g => g.name);
    const occupied = new Set(original.filter(g => normal(g) !== normal(replacement.name)).map(normal));
    if (args.candidates.some(name => occupied.has(normal(name)))) throw new Error('a candidate is already present in another slot');
  } finally { await probe.close(); }
  const setups = [{ name: 'baseline', gems: original }, ...args.candidates.map(name => ({
    name, gems: original.map(gem => normal(gem) === normal(args.replace_gem) ? name : gem),
  }))];
  const comparison = await compareGemSetups(context, { build_name: args.build_name, setups }, { xml, path });
  const same = metrics.every(key => comparison.baseline[key] === comparison.setups[0].stats[key]);
  if (!same) throw new Error('saved baseline changed during simulation; refusing to rank candidates');
  let metric = args.damage_metric;
  if (!metric) {
    const player = comparison.baseline.CombinedDPS;
    const minion = comparison.baseline.MinionCombinedDPS;
    if (typeof player === 'number' && player > 0 && (minion === null || minion === 0)) metric = 'CombinedDPS';
    else if (typeof minion === 'number' && minion > 0 && (player === null || player === 0)) metric = 'MinionCombinedDPS';
    else throw new Error('damage metric is ambiguous or unavailable; provide damage_metric explicitly');
  }
  const base = comparison.baseline[metric];
  if (typeof base !== 'number') throw new Error(`baseline ${metric} is unavailable`);
  const ranked: Array<{ gem: string; damage: number; delta: number; deltaPercent: number | null }> = [];
  const unranked: Array<{ gem: string; reason: string }> = [];
  for (const setup of comparison.setups.slice(1)) {
    const gem = setup.gems.find(g => normal(g.name) === normal(setup.name));
    const value = setup.stats[metric];
    if (gem?.appliedToSelectedSkill !== true) {
      unranked.push({ gem: setup.name, reason: gem?.appliedToSelectedSkill === false ? 'Not applied to the selected skill' : 'Support application is unknown' });
    } else if (typeof value !== 'number') {
      unranked.push({ gem: setup.name, reason: 'Damage metric is unavailable' });
    } else {
      const delta = value - base;
      const percent = base === 0 ? null : delta / base * 100;
      if (!Number.isFinite(delta)) {
        unranked.push({ gem: setup.name, reason: 'Damage change exceeds the supported numeric range' });
      } else {
        ranked.push({ gem: setup.name, damage: value, delta, deltaPercent: percent !== null && Number.isFinite(percent) ? percent : null });
      }
    }
  }
  ranked.sort((a, b) => b.damage - a.damage);
  return { source: comparison.source, activeGem: comparison.activeGem, replaceGem: args.replace_gem, metric, metricSelection: args.damage_metric ? 'explicit' : 'automatic', baseline: base, ranked, unranked,
    warnings: [...comparison.warnings, 'Only supplied candidates are compared, using the specified PoB configuration; the result is not a global optimum.',
      'Ranking does not assess defense, mana cost, play feel, clear coverage, or price.',
      ...(args.damage_metric ? [] : ['The damage metric was selected automatically from player or minion combined damage; another skill or metric may rank candidates differently.'])] };
}
