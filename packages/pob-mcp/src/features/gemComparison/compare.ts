import { toFiniteNumber, type PoBLuaApiClient } from '../../pobLuaBridge.js';
import { readNamedBuild } from '../../utils/namedBuild.js';
import { resolveBuildFile } from '../../utils/pathSanitizer.js';

interface CompareContext {
  pobDirectory?: string;
  createIsolatedLuaClient?: () => Promise<{ client: PoBLuaApiClient; close: () => Promise<void> }>;
}
interface Setup { name: string; gems: string[] }
const metrics = ['TotalDPS', 'CombinedDPS', 'MinionTotalDPS', 'MinionCombinedDPS'] as const;
const normalize = (name: string) => name.trim().toLowerCase();

/** Compare explicit full gem sets in a disposable PoB engine. */
export async function compareGemSetups(context: CompareContext, args: { build_name: string; skill_index?: number; setups: Setup[] }) {
  if (!args.build_name || !context.pobDirectory) throw new Error('build_name and builds directory are required');
  if (!Array.isArray(args.setups) || args.setups.length < 2 || args.setups.length > 5 || args.setups.some(setup =>
    !setup || typeof setup.name !== 'string' || !setup.name.trim() || !Array.isArray(setup.gems) ||
    !setup.gems.length || setup.gems.length > 6 || setup.gems.some(gem => typeof gem !== 'string' || !gem.trim()) ||
    new Set(setup.gems.map(normalize)).size !== setup.gems.length)) throw new Error('provide 2–5 named setups, each containing 1–6 distinct gem names');
  if (!context.createIsolatedLuaClient) throw new Error('isolated PoB engine is unavailable');
  const xml = await readNamedBuild(args.build_name, context.pobDirectory);
  const buildPath = resolveBuildFile(args.build_name, context.pobDirectory);
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
    const active = group.gems.filter(gem => !gem.isSupport);
    if (active.length !== 1 || !active[0].enabled || (group.mainActiveSkill ?? 1) !== 1) throw new Error('comparison requires exactly one enabled active gem with the first active effect selected');
    const activeGem = active[0];
    if (args.setups.some(setup => setup.gems.filter(gem => normalize(gem) === normalize(activeGem.name)).length !== 1)) {
      throw new Error(`each setup must include the existing active gem: ${activeGem.name}`);
    }
    const baseline = await client.getStats([...metrics]);
    const originalGems = new Map(group.gems.map(gem => [normalize(gem.name), gem]));
    const setups = [];
    for (const setup of args.setups) {
      await reload();
      const fresh = await client.getSkills();
      const freshGroup = fresh.groups.find(g => g.index === groupIndex);
      if (!freshGroup) throw new Error('main skill group disappeared while reloading');
      for (let i = freshGroup.gems.length; i >= 1; i--) await client.removeGem({ groupIndex: groupIndex!, gemIndex: i });
      const names = [activeGem.name, ...setup.gems.filter(name => normalize(name) !== normalize(activeGem.name))];
      for (const name of names) {
        const original = originalGems.get(normalize(name));
        await client.addGem({ groupIndex: groupIndex!, gemName: name, level: original?.level ?? 20,
          quality: original?.quality ?? 0, qualityId: original?.qualityId ?? 'Default', enabled: true,
          count: original?.count ?? 1, enableGlobal1: original?.enableGlobal1 ?? true, enableGlobal2: original?.enableGlobal2 ?? false });
      }
      const after = (await client.getSkills()).groups.find(g => g.index === groupIndex);
      if (!after || after.gems.length !== names.length || after.gems.filter(g => g.enabled && !g.isSupport).length !== 1) {
        throw new Error(`setup "${setup.name}" contains an unrecognized gem or more than one active gem`);
      }
      const stats = await client.getStats([...metrics]);
      setups.push({ name: setup.name, gems: names.map(name => ({ name, level: originalGems.get(normalize(name))?.level ?? 20,
        quality: originalGems.get(normalize(name))?.quality ?? 0, qualityId: originalGems.get(normalize(name))?.qualityId ?? 'Default',
        count: originalGems.get(normalize(name))?.count ?? 1 })),
        stats: Object.fromEntries(metrics.map(key => [key, toFiniteNumber(stats[key]) ?? null])) });
    }
    return { source: 'saved_build_isolated_pob', mainGroup: groupIndex, activeGem: activeGem.name,
      baseline: Object.fromEntries(metrics.map(key => [key, toFiniteNumber(baseline[key]) ?? null])), setups,
      warnings: ['使用已保存构筑和其配置，未读取当前未保存修改；当前构筑保持不变。',
        '新宝石按 20 级、0% 品质模拟；原有宝石保留等级和品质。请检查宝石版本、装备孔数和辅助兼容性。',
        '分别列出角色和召唤物伤害，不自动求和或判断最优；结果受 PoB 选中技能及配置影响。'] };
  } finally {
    await isolated.close();
  }
}
