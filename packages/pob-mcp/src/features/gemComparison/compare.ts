import { toFiniteNumber, type PoBLuaApiClient } from '../../adapters/pob/bridge.js';
import { readNamedBuild } from '../../utils/namedBuild.js';
import { resolveBuildFile } from '../../utils/pathSanitizer.js';

interface CompareContext {
  pobDirectory?: string;
  createIsolatedLuaClient?: () => Promise<{ client: PoBLuaApiClient; close: () => Promise<void> }>;
}
interface Setup { name: string; gems: string[]; gem_overrides?: Record<string, { level?: number; quality?: number }> }
const metrics = ['TotalDPS', 'CombinedDPS', 'MinionTotalDPS', 'MinionCombinedDPS'] as const;
const normalize = (name: string) => name.trim().toLowerCase();

/** Compare explicit full gem sets in a disposable PoB engine. */
export async function compareGemSetups(context: CompareContext, args: { build_name: string; skill_index?: number; setups: Setup[] }, snapshot?: { xml: string; path: string }) {
  if (!args.build_name || !context.pobDirectory) throw new Error('build_name and builds directory are required');
  if (!Array.isArray(args.setups) || args.setups.length < 2 || args.setups.length > 5 || args.setups.some(setup =>
    !setup || typeof setup.name !== 'string' || !setup.name.trim() || !Array.isArray(setup.gems) ||
    !setup.gems.length || setup.gems.length > 6 || setup.gems.some(gem => typeof gem !== 'string' || !gem.trim()) ||
    new Set(setup.gems.map(normalize)).size !== setup.gems.length)) throw new Error('provide 2–5 named setups, each containing 1–6 distinct gem names');
  for (const setup of args.setups) {
    if (setup.gem_overrides === undefined) continue;
    if (!setup.gem_overrides || typeof setup.gem_overrides !== 'object' || Array.isArray(setup.gem_overrides)) throw new Error('invalid gem_overrides');
    const names = new Set(setup.gems.map(normalize));
    const seen = new Set<string>();
    for (const [name, override] of Object.entries(setup.gem_overrides)) {
      const key = normalize(name);
      if (!names.has(key) || seen.has(key) || !override || typeof override !== 'object' || Array.isArray(override) ||
          (override.level === undefined && override.quality === undefined) ||
          (override.level !== undefined && (!Number.isInteger(override.level) || override.level < 1 || override.level > 40)) ||
          (override.quality !== undefined && (!Number.isInteger(override.quality) || override.quality < 0 || override.quality > 99))) {
        throw new Error(`invalid gem override: ${name}`);
      }
      seen.add(key);
    }
  }
  if (!context.createIsolatedLuaClient) throw new Error('isolated PoB engine is unavailable');
  const xml = snapshot?.xml ?? await readNamedBuild(args.build_name, context.pobDirectory);
  const buildPath = snapshot?.path ?? resolveBuildFile(args.build_name, context.pobDirectory);
  const isolated = await context.createIsolatedLuaClient();
  const { client } = isolated;
  try {
    const reload = () => client.loadBuildXml(xml, args.build_name.replace(/\.xml$/i, ''), buildPath);
    await reload();
    const skills = await client.getSkills();
    const mainIndex = skills.mainSocketGroup;
    const groupIndex = args.skill_index === undefined ? mainIndex : args.skill_index + 1;
    if (!Number.isInteger(groupIndex) || groupIndex !== mainIndex) throw new Error('comparison currently requires the saved main socket group');
    const group = skills.groups.find(g => g.index === groupIndex);
    if (!group || group.enabled === false) throw new Error('saved main skill group is missing or disabled');
    if (group.slotEnabled !== true) throw new Error(group.slotEnabled === false
      ? 'saved main skill group belongs to an inactive equipment slot' : 'saved main skill group equipment-slot state is unknown');
    const active = group.gems.filter(gem => !gem.isSupport);
    if (active.length !== 1 || !active[0].enabled || (group.mainActiveSkill ?? 1) !== 1) throw new Error('comparison requires exactly one enabled active gem with the first active effect selected');
    const activeGem = active[0];
    if (new Set(group.gems.map(gem => normalize(gem.name))).size !== group.gems.length) throw new Error('duplicate gem names in the saved group are ambiguous');
    if (args.setups.some(setup => setup.gems.filter(gem => normalize(gem) === normalize(activeGem.name)).length !== 1)) {
      throw new Error(`each setup must include the existing active gem: ${activeGem.name}`);
    }
    const baseline = await client.getStats([...metrics]);
    const setups = [];
    for (const setup of args.setups) {
      await reload();
      const fresh = await client.getSkills();
      const freshGroup = fresh.groups.find(g => g.index === groupIndex);
      if (!freshGroup) throw new Error('main skill group disappeared while reloading');
      const requested = new Set(setup.gems.map(normalize));
      // Keep original instances intact: rebuilding a visually identical gem
      // may lose PoB metadata and produce different DPS.
      const removedPositions: number[] = [];
      for (let i = freshGroup.gems.length - 1; i >= 0; i--) {
        if (!requested.has(normalize(freshGroup.gems[i].name))) {
          removedPositions.unshift(i + 1);
          await client.removeGem({ groupIndex: groupIndex!, gemIndex: i + 1 });
        }
      }
      const retained = (await client.getSkills()).groups.find(g => g.index === groupIndex);
      if (!retained) throw new Error('main skill group disappeared during comparison');
      for (const gem of retained.gems) {
        if (!gem.enabled) await client.setGemEnabled({ groupIndex: groupIndex!, gemIndex: gem.index, enabled: true });
      }
      const retainedNames = new Set(retained.gems.map(gem => normalize(gem.name)));
      let currentSize = retained.gems.length;
      let replacements = 0;
      for (const name of setup.gems) {
        if (!retainedNames.has(normalize(name))) {
          const formerPosition = removedPositions[replacements++];
          const insertIndex = formerPosition === undefined ? undefined : Math.min(formerPosition, currentSize + 1);
          await client.addGem({ groupIndex: groupIndex!, gemName: name, level: 20, quality: 0, qualityId: 'Default', enabled: true, insertIndex });
          currentSize++;
        }
      }
      const names = setup.gems;
      const beforeOverrides = (await client.getSkills()).groups.find(g => g.index === groupIndex);
      if (!beforeOverrides) throw new Error('main skill group disappeared during comparison');
      for (const [name, override] of Object.entries(setup.gem_overrides ?? {})) {
        const gem = beforeOverrides.gems.find(g => normalize(g.name) === normalize(name));
        if (!gem) throw new Error(`gem override not found: ${name}`);
        if (override.level !== undefined && override.level !== gem.level) await client.setGemLevel({ groupIndex: groupIndex!, gemIndex: gem.index, level: override.level });
        if (override.quality !== undefined && override.quality !== gem.quality) await client.setGemQuality({ groupIndex: groupIndex!, gemIndex: gem.index, quality: override.quality });
      }
      const after = (await client.getSkills()).groups.find(g => g.index === groupIndex);
      if (!after || after.gems.length !== names.length || after.gems.filter(g => g.enabled && !g.isSupport).length !== 1 ||
          names.some(name => !after.gems.some(gem => normalize(gem.name) === normalize(name)))) {
        throw new Error(`setup "${setup.name}" contains an unrecognized gem or more than one active gem`);
      }
      const stats = await client.getStats([...metrics]);
      setups.push({ name: setup.name, gems: names.map(name => {
        const gem = after.gems.find(g => normalize(g.name) === normalize(name))!;
        return { name: gem.name, groupPosition: gem.index, level: gem.level, quality: gem.quality, qualityId: gem.qualityId, count: gem.count ?? 1,
          ...(gem.isSupport ? { appliedToSelectedSkill: gem.appliedToSelectedSkill ?? null } : {}) };
      }), stats: Object.fromEntries(metrics.map(key => [key, toFiniteNumber(stats[key]) ?? null])) });
    }
    return { source: 'saved_build_isolated_pob', mainGroup: groupIndex, activeGem: activeGem.name,
      baseline: Object.fromEntries(metrics.map(key => [key, toFiniteNumber(baseline[key]) ?? null])), setups,
      warnings: ['Uses a saved build snapshot and its configuration; unsaved changes are not read and the current build is unchanged.',
        'New gems default to level 20 and 0% quality; retained gems keep their existing values unless overridden. PoB simulation inputs do not establish availability; verify gem versions, sockets and compatibility.',
        'Replacement gems fill removed positions in input order; other positions may move if the gem count changes.',
        'Support application to the selected skill comes from PoB; unknown does not mean applied.',
        'Player and minion damage are reported separately, without summing or selecting an optimum; results depend on PoB skill selection and configuration.'] };
  } finally {
    await isolated.close();
  }
}
