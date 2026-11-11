import type { BuildService } from "../services/buildService.js";
import type { SkillGemService } from "../services/skillGemService.js";
import type { PoBLuaApiClient } from "../adapters/pob/bridge.js";
import { wrapHandler } from "../utils/errorHandling.js";
import { withBuildClient } from "../utils/isolatedBuildClient.js";
import { compareGemSetups } from "../features/gemComparison/compare.js";
import { rankSupportGems } from "../features/supportRanking/rank.js";
import { listSupportCandidates } from "../features/supportCandidates/tool.js";
import { activeSkillSet, asArray } from "../utils/xmlCollections.js";

interface SkillGemHandlerContext {
  buildService: BuildService;
  skillGemService: SkillGemService;
  pobDirectory?: string;
  getLuaClient?: () => PoBLuaApiClient | null;
  ensureLuaClient?: () => Promise<void>;
  createIsolatedLuaClient?: () => Promise<{ client: PoBLuaApiClient; close: () => Promise<void> }>;
}

/**
 * Handle analyze_skill_links tool call
 */
export async function handleAnalyzeSkillLinks(
  context: SkillGemHandlerContext,
  args?: { build_name?: string; skill_index?: number }
) {
  if (!args?.build_name) throw new Error('build_name is required');
  const build = await context.buildService.readBuild(args.build_name);
  const groups = asArray(activeSkillSet(build)?.Skill);
  const index = args.skill_index ?? (Number(build.Build?.mainSocketGroup) - 1);
  if (!Number.isInteger(index) || index < 0 || index >= groups.length) throw new Error('saved skill group not found; supply a valid zero-based skill_index');
  const group = groups[index];
  const lines = [`=== 技能组 ${index + 1} ===`, '数据来源：已保存的构筑文件；不包含未保存修改。',
    group.enabled === 'false' ? '技能组已禁用。' : '技能组已启用。'];
  for (const gem of asArray(group.Gem)) {
    const source = gem.nameSpec || gem.name || gem.gemId || '未知宝石';
    const isSupport = gem.gemId?.includes('SupportGem') || gem.skillId?.startsWith('Support') || (gem.nameSpec ?? gem.name ?? '').toLowerCase().includes('support');
    const isActive = gem.gemId?.includes('SkillGem');
    const category = isSupport ? '辅助' : isActive ? '主动' : '类型未知';
    lines.push(`- ${source}：等级 ${gem.level ?? '未知'}，品质 ${gem.quality ?? '未知'}%；${category}${gem.enabled === 'false' ? '，已禁用' : ''}`);
  }
  lines.push('', '不根据宝石名称推断辅助兼容性或伤害；可用 compare_gem_setups 在 PoB 中比较明确的候选。');
  return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
}

/**
 * Handle suggest_support_gems tool call
 */
export async function handleSuggestSupportGems(
  context: SkillGemHandlerContext,
  args?: {
    build_name?: string;
    skill_index?: number;
    count?: number;
    include_exceptional?: boolean;
    budget?: "league_start" | "mid_league" | "endgame";
    query?: string;
  }
) {
  if (!args?.build_name) throw new Error('build_name is required');
  const result = await listSupportCandidates(context, args);
  return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
}

/**
 * Handle compare_gem_setups tool call
 */
export async function handleCompareGemSetups(
  context: SkillGemHandlerContext,
  args: {
    build_name: string;
    skill_index?: number;
    setups: Array<{ name: string; gems: string[]; gem_overrides?: Record<string, { level?: number; quality?: number }> }>;
  }
) {
  const result = await compareGemSetups(context, args);
  return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
}

export async function handleRankSupportGems(context: SkillGemHandlerContext, args: Parameters<typeof rankSupportGems>[1]) {
  const result = await rankSupportGems(context, args);
  return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
}

/**
 * Handle validate_gem_quality tool call
 */
export async function handleValidateGemQuality(
  context: SkillGemHandlerContext,
  args?: { build_name?: string; include_corrupted?: boolean }
) {
  if (!args?.build_name) throw new Error('build_name is required');
  const build = await context.buildService.readBuild(args.build_name);
  const groups = asArray(activeSkillSet(build)?.Skill);
  const lines = ['=== 宝石品质检查 ===', '数据来源：已保存的构筑文件；品质收益和腐化状态未计算。'];
  for (const [index, group] of groups.entries()) {
    for (const gem of asArray(group.Gem)) {
      lines.push(`- 技能组 ${index + 1}：${gem.nameSpec || gem.name || gem.gemId || '未知宝石'}，等级 ${gem.level ?? '未知'}，品质 ${gem.quality ?? '未知'}%${gem.enabled === 'false' || group.enabled === 'false' ? '（已禁用）' : ''}`);
    }
  }
  if (groups.length === 0) lines.push('没有可读取的技能组。');
  if (args.include_corrupted) lines.push('PoB 文件未确认宝石腐化状态，不推断腐化概率或结果。');
  return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
}

/**
 * Handle find_optimal_links tool call
 */
export async function handleFindOptimalLinks(
  context: SkillGemHandlerContext,
  args: {
    build_name: string;
    skill_index?: number;
    link_count: number;
    budget?: "league_start" | "mid_league" | "endgame";
  }
) {
  if (!args.build_name) throw new Error('build_name is required');
  if (!Number.isInteger(args.link_count) || args.link_count < 4 || args.link_count > 6) throw new Error('link_count must be between 4 and 6');
  const facts = await handleAnalyzeSkillLinks(context, { build_name: args.build_name, skill_index: args.skill_index });
  facts.content[0].text += `\n\n尚未搜索或验证最优 ${args.link_count} 连；请提供候选方案，用 compare_gem_setups 计算或 rank_support_gems 对有限候选排序。预算和价格未验证。`;
  return facts;
}

/**
 * Handle gem_upgrade_path tool call
 */
export async function handleGemUpgradePath(
  context: SkillGemHandlerContext,
  args: { build_name?: string; budget?: string }
) {
  if (!context.ensureLuaClient || !context.getLuaClient) throw new Error('Lua bridge not configured.');
  if (args.build_name && !context.pobDirectory) throw new Error('Build directory is unavailable.');
  return withBuildClient({ pobDirectory: context.pobDirectory ?? '', getLuaClient: context.getLuaClient,
    ensureLuaClient: context.ensureLuaClient, createIsolatedLuaClient: context.createIsolatedLuaClient },
    args.build_name, async (client, isolated) => {
      const skills = await client.getSkills();
      const lines = ['=== 宝石检查 ===', isolated ? '数据来源：已保存构筑，独立引擎计算' : '数据来源：当前内存构筑',
        '以下仅列出已启用技能组中的宝石；不计算升级收益、价格或腐化概率。', ''];
      for (const group of skills.groups ?? []) {
        if (group.enabled === false) continue;
        const gems = (group.gems ?? []).filter(gem => gem.enabled !== false);
        if (!gems.length) continue;
        lines.push(`技能组 ${group.index}${group.index === skills.mainSocketGroup ? '（主技能组）' : ''}${group.label ? `：${group.label}` : ''}`);
        for (const gem of gems) {
          lines.push(`- ${gem.name}：等级 ${gem.level}，品质 ${gem.quality}%；${gem.isSupport ? '辅助' : '主动'}`);
        }
      }
      lines.push('', '升级前请用 PoB 比较实际效果，并查询当前赛季价格；等级和品质较低可能是有意配置。');
      if (args.budget) lines.push('未按预算排序：缺少可验证的当前价格及收益。');
      return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
    });
}
