import type { PoBLuaApiClient, StatsExport } from '../pobLuaBridge.js';
import type { PoeNinjaClient } from '../services/poeNinjaClient.js';
import { fetchBaseModData } from '../services/craftingDataService.js';
import { wrapHandler, noteIgnoredError } from '../utils/errorHandling.js';

interface CraftingAdvisorContext {
  getLuaClient: () => PoBLuaApiClient | null;
  ninjaClient: PoeNinjaClient;
}

interface CraftingResponseInput {
  base: string;
  slot: string;
  desiredMods: string[];
  modData: string;
  currencyRates: { chaos: number; divine?: number; live: boolean };
  buildContext: StatsExport | null;
  league?: string;
  baseFromEquipped?: boolean;
  ilvl?: number;
  budget?: 'low' | 'medium' | 'high';
}

const slotMap: Record<string, string> = {
  helmet: 'Helmet', chest: 'Body Armour', gloves: 'Gloves', boots: 'Boots',
  weapon: 'Weapon 1', offhand: 'Weapon 2', ring: 'Ring 1', amulet: 'Amulet', belt: 'Belt',
};

/** Context only: this tool does not validate crafting rules or calculate probabilities. */
export function buildCraftingResponse(input: CraftingResponseInput): string {
  let text = `=== 制作资料：${input.base} (${input.slot}) ===\n\n`;
  if (input.baseFromEquipped) text += '底材来自当前装备；不代表目标物品具有相同物品等级、词缀或特殊状态。\n\n';
  text += `## 目标词缀\n${input.desiredMods.length ? input.desiredMods.map(mod => `- ${mod}`).join('\n') : '未指定。'}\n\n`;
  if (input.ilvl !== undefined) text += `物品等级：${input.ilvl}（由调用方提供，未验证）\n`;
  if (input.budget !== undefined) text += `预算档位：${input.budget}（调用方主观描述，不代表固定金额）\n`;
  if (input.buildContext) {
    text += '\n## BD 数据\n';
    for (const [key, value] of Object.entries(input.buildContext)) {
      if (key !== '_meta' && (typeof value === 'number' || typeof value === 'string')) text += `- ${key}: ${value}\n`;
    }
  }
  text += '\n## 通货参考\n';
  if (!input.league) text += '未指定国际服赛季，未查询价格。\n';
  else if (input.currencyRates.live && Number.isFinite(input.currencyRates.divine) && (input.currencyRates.divine ?? 0) > 0) {
    text += `赛季：${input.league}；poe.ninja 参考汇率：1 Divine Orb = ${input.currencyRates.divine} Chaos Orb。数据可能来自缓存，不代表可立即成交的一口价。\n`;
  } else text += `赛季：${input.league}；未取得有效汇率，不使用占位价格。\n`;
  text += `\n## 底材资料\n${input.modData || '未取得资料。'}\n`;
  text += '\n此工具只收集背景信息，不是工艺规则引擎或概率模拟器。给出制作步骤前，需要独立核实游戏版本、目标物品的等级、已有词缀及空位、特殊状态、各步骤的规则和风险。词缀概率与制作成本缺少可靠依据时应标为未知，并可与官方交易站可立即购买的一口价比较。';
  return text;
}

export async function handleSuggestCrafting(context: CraftingAdvisorContext, args: {
  slot: string; base?: string; desired_mods?: string[]; budget?: 'low' | 'medium' | 'high'; ilvl?: number; league?: string;
}) {
  return wrapHandler('suggest crafting', async () => {
    const slot = typeof args.slot === 'string' ? args.slot.trim().toLowerCase() : '';
    if (!Object.prototype.hasOwnProperty.call(slotMap, slot)) throw new Error('Invalid slot');
    if (args.base !== undefined && (typeof args.base !== 'string' || !args.base.trim() || args.base.length > 120)) throw new Error('Invalid base');
    if (args.league !== undefined && (typeof args.league !== 'string' || !args.league.trim() || args.league.length > 120)) throw new Error('Invalid league');
    if (args.desired_mods !== undefined && (!Array.isArray(args.desired_mods) || args.desired_mods.length > 20 || args.desired_mods.some(mod => typeof mod !== 'string' || !mod.trim() || mod.length > 200))) throw new Error('Invalid desired_mods');
    if (args.ilvl !== undefined && (!Number.isInteger(args.ilvl) || args.ilvl < 1 || args.ilvl > 100)) throw new Error('Invalid ilvl');
    if (args.budget !== undefined && !['low', 'medium', 'high'].includes(args.budget)) throw new Error('Invalid budget');
    const league = args.league?.trim();
    let base = args.base?.trim();
    let baseFromEquipped = false;
    let buildContext: StatsExport | null = null;
    const luaClient = context.getLuaClient();
    if (luaClient) {
      try {
        buildContext = await luaClient.getStats(['Life', 'EnergyShield', 'FireResist', 'ColdResist', 'LightningResist', 'ChaosResist', 'TotalDPS', 'MinionTotalDPS', 'CombinedDPS', 'MinionCombinedDPS', 'Armour', 'Evasion']);
      } catch (e) { noteIgnoredError('PoB build stats unavailable', e); }
      if (!base) {
        try {
          const items = await luaClient.getItems();
          const item = items.find(i => i.slot === slotMap[slot] && i.shown !== false && i.id > 0 && typeof i.baseName === 'string' && i.baseName.trim());
          if (item?.baseName) { base = item.baseName.trim(); baseFromEquipped = true; }
        } catch (e) { noteIgnoredError('PoB equipped item unavailable', e); }
      }
    }
    if (!base) return { content: [{ type: 'text', text: `请提供底材名称：无法从 ${slot} 部位读取已装备物品。` }] };
    let currencyRates: CraftingResponseInput['currencyRates'] = { chaos: 1, live: false };
    if (league) {
      try {
        const divine = (await context.ninjaClient.getCurrencyExchangeMap(league)).get('Divine Orb');
        if (typeof divine === 'number' && Number.isFinite(divine) && divine > 0) currencyRates = { chaos: 1, divine, live: true };
      } catch (e) { noteIgnoredError('poe.ninja unavailable', e); }
    }
    let modData: string;
    try { modData = (await fetchBaseModData(base)).modText; }
    catch (err) { modData = `未能核实 poedb 底材页面：${err instanceof Error ? err.message : String(err)}`; }
    return { content: [{ type: 'text', text: buildCraftingResponse({ base, slot, desiredMods: args.desired_mods ?? [], modData,
      currencyRates, buildContext, league, baseFromEquipped, ilvl: args.ilvl, budget: args.budget }) }] };
  });
}
