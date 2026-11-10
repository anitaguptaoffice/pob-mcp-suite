import type { PoBLuaApiClient } from '../../pobLuaBridge.js';
import { withBuildClient } from '../../utils/isolatedBuildClient.js';

interface Context {
  pobDirectory?: string;
  getLuaClient?: () => PoBLuaApiClient | null;
  ensureLuaClient?: () => Promise<void>;
  createIsolatedLuaClient?: () => Promise<{ client: PoBLuaApiClient; close: () => Promise<void> }>;
}
export async function listSupportCandidates(context: Context, args: { build_name?: string; skill_index?: number; count?: number; query?: string; include_exceptional?: boolean; budget?: string }) {
  if (!args.build_name || !context.pobDirectory || !context.ensureLuaClient || !context.getLuaClient) throw new Error('build_name and PoB engine are required');
  if (args.skill_index !== undefined && (!Number.isInteger(args.skill_index) || args.skill_index < 0)) throw new Error('skill_index must be a non-negative integer');
  if (args.count !== undefined && (!Number.isInteger(args.count) || args.count < 1 || args.count > 100)) throw new Error('count must be 1–100');
  if (args.query !== undefined && (typeof args.query !== 'string' || args.query.length > 80)) throw new Error('query must be a string of at most 80 characters');
  if (args.include_exceptional !== undefined && typeof args.include_exceptional !== 'boolean') throw new Error('include_exceptional must be boolean');
  return withBuildClient({ pobDirectory: context.pobDirectory, getLuaClient: context.getLuaClient, ensureLuaClient: context.ensureLuaClient,
    createIsolatedLuaClient: context.createIsolatedLuaClient }, args.build_name, async (client, isolated) => {
    const result = await client.getCompatibleSupports({ groupIndex: args.skill_index === undefined ? undefined : args.skill_index + 1,
      query: args.query?.trim(), limit: args.count ?? 25, includeExceptional: args.include_exceptional ?? true });
    return { source: isolated ? 'saved_build_isolated_pob' : 'current_live_build', ...result,
      warnings: ['候选按 PoB 所选技能的兼容性筛选，不代表必定提高伤害；请用宝石方案比较实测。',
        '按名称排序，未考虑价格、宝石是否可获取、孔色或装备要求。',
        ...(args.budget ? ['预算参数未用于筛选；请单独查询当前赛季价格。'] : []),
        ...(result.failed ? [`${result.failed} 个候选的兼容性检查失败，结果可能不完整。`] : []),
      ] };
  });
}
