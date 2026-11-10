import { toFiniteNumber, type PoBLuaApiClient } from '../../pobLuaBridge.js';
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
export async function compareGemSetups(context: CompareContext, args: { build_name: string; skill_index?: number; setups: Setup[] }) {
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
          (override.quality !== undefined && (!Number.isInteger(override.quality) || override.quality < 0 || override.quality > 23))) {
        throw new Error(`invalid gem override: ${name}`);
      }
      seen.add(key);
    }
  }
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
      for (let i = freshGroup.gems.length - 1; i >= 0; i--) {
        if (!requested.has(normalize(freshGroup.gems[i].name))) {
          await client.removeGem({ groupIndex: groupIndex!, gemIndex: i + 1 });
        }
      }
      const retained = (await client.getSkills()).groups.find(g => g.index === groupIndex);
      if (!retained) throw new Error('main skill group disappeared during comparison');
      for (const gem of retained.gems) {
        if (!gem.enabled) await client.setGemEnabled({ groupIndex: groupIndex!, gemIndex: gem.index, enabled: true });
      }
      const retainedNames = new Set(retained.gems.map(gem => normalize(gem.name)));
      for (const name of setup.gems) {
        if (!retainedNames.has(normalize(name))) {
          await client.addGem({ groupIndex: groupIndex!, gemName: name, level: 20, quality: 0, qualityId: 'Default', enabled: true });
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
      if (!after || after.gems.length !== names.length || after.gems.filter(g => g.enabled && !g.isSupport).length !== 1) {
        throw new Error(`setup "${setup.name}" contains an unrecognized gem or more than one active gem`);
      }
      const stats = await client.getStats([...metrics]);
      setups.push({ name: setup.name, gems: names.map(name => {
        const gem = after.gems.find(g => normalize(g.name) === normalize(name))!;
        return { name: gem.name, level: gem.level, quality: gem.quality, qualityId: gem.qualityId, count: gem.count ?? 1,
          ...(gem.isSupport ? { appliedToSelectedSkill: gem.appliedToSelectedSkill ?? null } : {}) };
      }), stats: Object.fromEntries(metrics.map(key => [key, toFiniteNumber(stats[key]) ?? null])) });
    }
    return { source: 'saved_build_isolated_pob', mainGroup: groupIndex, activeGem: activeGem.name,
      baseline: Object.fromEntries(metrics.map(key => [key, toFiniteNumber(baseline[key]) ?? null])), setups,
      warnings: ['使用已保存构筑和其配置，未读取当前未保存修改；当前构筑保持不变。',
        '未指定时，新宝石按 20 级、0% 品质模拟，原有宝石保留等级和品质；显式设置会覆盖它们。等级和品质属于 PoB 模拟输入，不保证游戏中可获得；请检查宝石版本、装备孔数和辅助兼容性。',
        '辅助宝石是否作用于选中技能取自 PoB 计算结果；未知状态不能视为已生效。',
        '分别列出角色和召唤物伤害，不自动求和或判断最优；结果受 PoB 选中技能及配置影响。'] };
  } finally {
    await isolated.close();
  }
}
