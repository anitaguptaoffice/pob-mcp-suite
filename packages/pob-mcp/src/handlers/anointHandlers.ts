import type { PoBLuaApiClient } from '../pobLuaBridge.js';
import { wrapHandler } from '../utils/errorHandling.js';

export async function handleFindBestAnointment(context: { getLuaClient: () => PoBLuaApiClient | null; ensureLuaClient: () => Promise<void> }, args: { slot: string; focus?: 'dps' | 'defence' | 'both'; max_results?: number }) {
  return wrapHandler('find best anointment', async () => {
    await context.ensureLuaClient();
    const client = context.getLuaClient();
    if (!client) throw new Error('Lua bridge not active. Use lua_start and lua_load_build first.');
    const result = await client.evaluateAnointCandidates({ slot: args.slot, focus: args.focus, limit: Math.max(args.max_results ?? 10, 50) });
    const top = result.candidates.slice(0, args.max_results ?? 10);
    const baseDamage = result.base.damageValue;
    const lines = [`=== 涂油试算 (slot: ${result.slot} / ${result.baseType}, focus: ${result.focus}) ===`, '', `基准（移除当前涂油）：${result.base.damageStat ?? '伤害未提供'}: ${baseDamage === undefined ? '未提供' : Math.round(baseDamage).toLocaleString()} | TotalEHP: ${result.base.ehpAvailable === false ? '未提供' : Math.round(result.base.TotalEHP).toLocaleString()}`, `已试算 ${result.evaluated} 项，跳过 ${result.skipped} 项，显示 ${top.length} 项；结果取决于当前技能和配置。`, ''];
    for (const [index, candidate] of top.entries()) {
      const dpsPct = baseDamage ? candidate.dpsDelta / baseDamage * 100 : 0;
      const ehpPct = result.base.TotalEHP ? candidate.ehpDelta / result.base.TotalEHP * 100 : 0;
      lines.push(`${index + 1}. **${candidate.name}** [${candidate.nodeId}]`, `   Score: ${candidate.score.toFixed(4)}${baseDamage ? ` | ${result.base.damageStat} Δ: ${candidate.dpsDelta >= 0 ? '+' : ''}${Math.round(candidate.dpsDelta).toLocaleString()} (${dpsPct >= 0 ? '+' : ''}${dpsPct.toFixed(2)}%)` : ''}${result.base.ehpAvailable === false ? '' : ` | TotalEHP Δ: ${candidate.ehpDelta >= 0 ? '+' : ''}${Math.round(candidate.ehpDelta).toLocaleString()} (${ehpPct >= 0 ? '+' : ''}${ehpPct.toFixed(2)}%)`}`);
      if (candidate.recipe?.length) lines.push(`   Oils: ${candidate.recipe.join(' + ')}`);
      lines.push('');
    }
    if (!top.length) lines.push('No candidates were evaluated. Check the selected anointable item and loaded build.');
    return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
  });
}
