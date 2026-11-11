import type { PoBLuaApiClient } from "../adapters/pob/bridge.js";
import { toFiniteNumber } from "../adapters/pob/bridge.js";
import { wrapHandler } from "../utils/errorHandling.js";

interface BossReadinessContext {
  getLuaClient: () => PoBLuaApiClient | null;
  ensureLuaClient: () => Promise<void>;
}

interface BossThreshold {
  name: string;
  minLife: number;
  minDPS: number;
  minEHP: number;
  notes: string[];
  mechanics: string[];
}

const BOSS_THRESHOLDS: Record<string, BossThreshold> = {
  shaper: {
    name: 'The Shaper',
    minLife: 5000, minDPS: 1_000_000, minEHP: 30_000,
    notes: ['75% elemental resists required', 'High cold damage — spell suppression/dodge helps'],
    mechanics: ['Stand in rotating beam = instant death', 'Move out of Shaper Slam circle', 'Ice prison requires ES or granite flask'],
  },
  elder: {
    name: 'The Elder',
    minLife: 5000, minDPS: 800_000, minEHP: 25_000,
    notes: ['75% elemental + 0%+ chaos recommended', 'DoT phases require recovery layers'],
    mechanics: ['Spiral of storms — keep moving', 'Tentacle Miscreations must be killed quickly'],
  },
  sirus: {
    name: 'Sirus, Awakener of Worlds',
    minLife: 5500, minDPS: 2_000_000, minEHP: 35_000,
    notes: ['Phase 4 meteors are one-shots without positioning', 'Chaos resistance strongly recommended (60%+ ideal)'],
    mechanics: ['Die beams — walk between the lines', 'Maze phase — follow correct portals', 'Corridor phase — avoid tunnel walls'],
  },
  maven: {
    name: 'The Maven',
    minLife: 6000, minDPS: 3_000_000, minEHP: 40_000,
    notes: ['Memory game insta-kills on failure', 'Very high damage output in final phases'],
    mechanics: ['Memory game — memorise the sequence and repeat it', 'Avoid brain phases', 'Maven orbs — stay mobile'],
  },
  uber_elder: {
    name: 'Uber Elder',
    minLife: 6000, minDPS: 1_500_000, minEHP: 40_000,
    notes: ['Dual-boss encounter — constant movement required', 'Cold snap ground persists and covers the arena'],
    mechanics: ['Avoid Elder circle and Shaper beams simultaneously', 'High DPS window when Shaper kneels'],
  },
  eater: {
    name: 'Eater of Worlds (Uber)',
    minLife: 6000, minDPS: 4_000_000, minEHP: 50_000,
    notes: ['Physical damage primary — armour/PDR very valuable', 'Tentacles apply stacking debuffs'],
    mechanics: ['Move to remove tentacle stacks', 'Dodge projectile waves'],
  },
  exarch: {
    name: 'Searing Exarch (Uber)',
    minLife: 6000, minDPS: 4_000_000, minEHP: 50_000,
    notes: ['Fire/cold damage — suppression + capped resists required', 'Phases escalate significantly'],
    mechanics: ['Avoid meteor impact zones', 'Kill adds quickly during add phase'],
  },
  pinnacle: {
    name: 'Generic Pinnacle Boss',
    minLife: 6000, minDPS: 3_000_000, minEHP: 40_000,
    notes: ['General endgame readiness check'],
    mechanics: ['Capped resistances essential', 'Flask immunities (bleed, freeze, poison) required'],
  },
};

const BOSS_ALIASES: Record<string, string> = {
  'awakener': 'sirus',
  'searing exarch': 'exarch',
  'eater of worlds': 'eater',
  'uber eater': 'eater',
  'uber eater of worlds': 'eater',
  'uber exarch': 'exarch',
  'uber searing exarch': 'exarch',
  'endgame': 'pinnacle',
  'generic': 'pinnacle',
};

export async function handleCheckBossReadiness(context: BossReadinessContext, boss: string) {
  return wrapHandler('check boss readiness', async () => {
  await context.ensureLuaClient();
  const luaClient = context.getLuaClient();
  if (!luaClient) throw new Error('Lua bridge not active. Use lua_load_build first.');

  const key = BOSS_ALIASES[boss.toLowerCase()] ?? boss.toLowerCase().replace(/\s+/g, '_');
  const threshold = BOSS_THRESHOLDS[key];
  if (!threshold || ['eater', 'exarch'].includes(key) && !/uber/i.test(boss)) {
    return { content: [{ type: 'text' as const, text: `无法识别或明确区分首领难度：${boss}。请提供受支持的明确首领名称；不会替换成其他首领。` }] };
  }

  const stats = await luaClient.getStats([
    'Life', 'TotalEHP', 'EnergyShield',
    'TotalDPS', 'CombinedDPS', 'MinionTotalDPS', 'MinionCombinedDPS',
    'FireResist', 'ColdResist', 'LightningResist', 'ChaosResist',
    'EffectiveSpellSuppressionChance', 'SpellSuppressionChance',
    'Armour', 'PhysicalDamageReduction', 'EvasionChance',
  ]);

  const life = toFiniteNumber(stats.Life);
  const es = toFiniteNumber(stats.EnergyShield);
  const ehp = toFiniteNumber(stats.TotalEHP);
  const damageKey = (['CombinedDPS', 'TotalDPS', 'MinionCombinedDPS', 'MinionTotalDPS'] as const).find(k => (toFiniteNumber(stats[k]) ?? 0) > 0);
  const dps = damageKey ? toFiniteNumber(stats[damageKey]) : undefined;
  const fireRes = toFiniteNumber(stats.FireResist);
  const coldRes = toFiniteNumber(stats.ColdResist);
  const lightRes = toFiniteNumber(stats.LightningResist);
  const chaosRes = toFiniteNumber(stats.ChaosResist);

  interface StatCheck {
    label: string;
    value: string;
    pass: boolean | null;
    critical: boolean;
  }

  const checks: StatCheck[] = [
    {
      label: 'Life',
      value: life === undefined ? '未提供' : life.toLocaleString(),
      pass: life === undefined || (life === 1 && (es ?? 0) > 0) ? null : life >= threshold.minLife,
      critical: life !== undefined && life !== 1 && life < threshold.minLife * 0.7,
    },
    {
      label: 'Effective HP',
      value: ehp === undefined ? '未提供' : ehp.toLocaleString(),
      pass: ehp === undefined ? null : ehp >= threshold.minEHP,
      critical: ehp !== undefined && ehp < threshold.minEHP * 0.6,
    },
    {
      label: 'DPS',
      value: dps === undefined ? '未提供' : `${dps.toLocaleString()} (${damageKey})`,
      pass: dps === undefined ? null : dps >= threshold.minDPS,
      critical: dps !== undefined && dps < threshold.minDPS * 0.3,
    },
    ...(['Fire', 'Cold', 'Lightning'] as const).map(elem => {
      const val = elem === 'Fire' ? fireRes : elem === 'Cold' ? coldRes : lightRes;
      return { label: `${elem} Resist`, value: val === undefined ? '未提供' : `${val}%`, pass: val === undefined ? null : val >= 75, critical: val !== undefined && val < 50 };
    }),
    {
      label: 'Chaos Resist',
      value: chaosRes === undefined ? '未提供' : `${chaosRes}%`,
      pass: chaosRes === undefined ? null : chaosRes >= 0,
      critical: chaosRes !== undefined && chaosRes < -30,
    },
  ];

  const passed = checks.filter(c => c.pass).length;
  const criticalFails = checks.filter(c => c.pass === false && c.critical);
  const minorFails = checks.filter(c => c.pass === false && !c.critical);
  const unknown = checks.filter(c => c.pass === null).length;

  let output = `=== Boss Readiness: ${threshold.name} ===\n\n`;
  output += `这些阈值仅为粗略参考，不证明能否击败首领；构筑机制、技能配置和玩家操作均会影响结果。${passed} 项达到参考值，${criticalFails.length + minorFails.length} 项未达到，${unknown} 项无法判断或不适用。\n\n`;

  output += '**Stat Checks:**\n';
  for (const c of checks) {
    const icon = c.pass === null ? '❔' : c.pass ? '✅' : c.critical ? '🔴' : '🟡';
    const req =
      c.label === 'Life'         ? ` (need ${threshold.minLife.toLocaleString()}+)` :
      c.label === 'Effective HP' ? ` (need ${threshold.minEHP.toLocaleString()}+)` :
      c.label === 'DPS'          ? ` (need ~${threshold.minDPS.toLocaleString()}+)` :
      c.label !== 'Chaos Resist' ? ' (need 75%)' : ' (need 0%+)';
    output += `  ${icon} ${c.label}: ${c.value}${req}\n`;
  }

  if (criticalFails.length > 0) {
    output += `\n**明显低于参考值的指标：**\n`;
    for (const f of criticalFails) output += `  🔴 ${f.label} is dangerously low\n`;
  }
  if (minorFails.length > 0) {
    output += `\n**Recommended Improvements:**\n`;
    for (const f of minorFails) output += `  🟡 ${f.label} below threshold\n`;
  }

  output += '\n首领机制、最大承受单次伤害、恢复与操作尚未由此工具评估。\n';

  return { content: [{ type: 'text' as const, text: output }] };
  });
}
