import { toFiniteNumber, type PoBLuaApiClient } from "../adapters/pob/bridge.js";
import { noteIgnoredError } from '../utils/errorHandling.js';
import type { BuildService } from "../services/buildService.js";
import { activeItemSlotsOf, itemTextMapOf } from "../utils/pobXml.js";
import {
  analyzeEquippedItems,
  formatItemAnalysis,
  inferBuildArchetype,
  type BuildStats,
} from "../domain/itemAnalysis.js";
import {
  analyzeSkillSetup,
  formatSkillOptimization,
  type SkillGroup,
} from "../skillLinkOptimizer.js";
import { withBuildClient } from "../utils/isolatedBuildClient.js";
import { activeSkillSet, asArray } from "../utils/xmlCollections.js";

interface AdvancedOptimizationContext {
  buildService: BuildService;
  pobDirectory: string;
  getLuaClient: () => PoBLuaApiClient | null;
  ensureLuaClient: () => Promise<void>;
  createIsolatedLuaClient?: () => Promise<{ client: PoBLuaApiClient; close: () => Promise<void> }>;
}

/**
 * Analyze equipped items and suggest upgrades
 */
export async function handleAnalyzeItems(
  context: AdvancedOptimizationContext,
  buildName?: string
) {
  try {
    let items: Array<{ slot: string; name?: string; baseName?: string; rarity?: string }> = [];
    let className: string | undefined;
    let ascendClassName: string | undefined;
    let stats: BuildStats | undefined;

    let dataSource = '已保存的 XML（缓存数值，未进行实时计算）';
    let liveReadSucceeded = false;
    try {
      const live = await withBuildClient(context, buildName, async (luaClient, isolated) => {
        const luaItems = await luaClient.getItems();
        const luaStats = await luaClient.getStats(['Life', 'EnergyShield', 'Evasion', 'Armour', 'TotalDPS', 'FireResist', 'ColdResist', 'LightningResist', 'ChaosResist']);
        const tree = await luaClient.getTree();
        const classNames = ['Scion', 'Marauder', 'Ranger', 'Witch', 'Duelist', 'Templar', 'Shadow'];
        return { items: luaItems.map(item => ({ slot: item.slot, name: item.name, baseName: item.baseName, rarity: item.rarity, shown: item.shown })),
          className: classNames[tree.classId], isolated,
          stats: { life: toFiniteNumber(luaStats.Life), energyShield: toFiniteNumber(luaStats.EnergyShield),
            evasion: toFiniteNumber(luaStats.Evasion), armour: toFiniteNumber(luaStats.Armour), dps: toFiniteNumber(luaStats.TotalDPS),
            fireRes: toFiniteNumber(luaStats.FireResist), coldRes: toFiniteNumber(luaStats.ColdResist),
            lightningRes: toFiniteNumber(luaStats.LightningResist), chaosRes: toFiniteNumber(luaStats.ChaosResist) } };
      });
      items = live.items;
      className = live.className;
      stats = live.stats;
      liveReadSucceeded = true;
      dataSource = live.isolated ? '已保存构筑，独立引擎计算' : '当前内存构筑';
    } catch (error) {
      if (!buildName) throw error;
      noteIgnoredError('live item analysis unavailable — use saved XML', error);
    }

    // Fall back to XML if no Lua data
    if (!liveReadSucceeded && buildName) {
      const build = await context.buildService.readBuild(buildName);

      className = className || build.Build?.className;
      ascendClassName = build.Build?.ascendClassName;

      // Extract items from XML — via the shared active-set normalisation:
      // ItemSet is an array whenever a build has >1 gear set, which the
      // previous single-object read silently mishandled.
      const xmlSlots = activeItemSlotsOf(build);
      if (xmlSlots.length > 0) {
        // Slot elements carry no item text - the bodies live in Items/Item,
        // joined by itemId (same lookup ShoppingListService uses). No engine
        // here, so hidden-empty gating relies on treeVersion alone; an empty
        // Graft/Ring 3 that the engine WOULD hide is simply not flagged in
        // this fallback path (better silence than false demands).
        const itemTexts = itemTextMapOf(build);
        items = xmlSlots.map((slot) => {
          const filled = Boolean(slot.itemId && slot.itemId !== '0');
          const itemText = filled ? itemTexts.get(String(slot.itemId)) ?? '' : '';
          const lines = itemText.split('\n');
          const rarity = lines.find((l) => /^Rarity:/.test(l.trim()))?.split(':').slice(1).join(':').trim();
          const name = lines.find((l) => l.trim() !== '' && !/^(Item Class|Rarity):/.test(l.trim()))?.trim() ?? '';

          return {
            slot: slot.name || 'Unknown',
            name,
            rarity,
          };
        });
      }

      // Extract stats from XML
      if (!stats && build.Build?.PlayerStat) {
        const statsArray = Array.isArray(build.Build.PlayerStat)
          ? build.Build.PlayerStat
          : [build.Build.PlayerStat];

        stats = {};
        const keys: Record<string, keyof BuildStats> = { Life: 'life', EnergyShield: 'energyShield', Evasion: 'evasion', Armour: 'armour', TotalDPS: 'dps', FireResist: 'fireRes', ColdResist: 'coldRes', LightningResist: 'lightningRes', ChaosResist: 'chaosRes' };
        for (const stat of statsArray) {
          const key = keys[stat.stat];
          const value = toFiniteNumber(stat.value);
          if (key && value !== undefined) stats[key] = value;
        }
      }
    }

    // Analyze items
    const analysis = analyzeEquippedItems(items, className, ascendClassName, stats);
    const formatted = formatItemAnalysis(analysis);

    return {
      content: [
        {
          type: "text" as const,
          text: `数据来源：${dataSource}\n\n${formatted}`,
        },
      ],
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to analyze items: ${errorMsg}`);
  }
}

/**
 * Analyze skill links and suggest optimizations
 */
export async function handleOptimizeSkillLinks(
  context: AdvancedOptimizationContext,
  buildName?: string
) {
  try {
    let skillGroups: SkillGroup[] = [];
    let buildArchetype = 'unknown';

    let dataSource = '已保存的 XML（未进行实时计算）';
    let liveReadSucceeded = false;
    try {
      const live = await withBuildClient(context, buildName, async (luaClient, isolated) => {
        const skillData = await luaClient.getSkills();
        const tree = await luaClient.getTree();
        const stats = await luaClient.getStats(['TotalDPS', 'Life', 'EnergyShield']);
        const classNames = ['Scion', 'Marauder', 'Ranger', 'Witch', 'Duelist', 'Templar', 'Shadow'];
        return { isolated, groups: skillData.groups.map(group => ({ index: group.index, label: group.label, slot: group.slot,
          enabled: group.enabled ?? true, isMainSkill: group.index === skillData.mainSocketGroup,
          gems: group.gems || group.skills?.map(name => ({ name })) || [], includeInFullDPS: group.includeInFullDPS })),
          archetype: inferBuildArchetype(classNames[tree.classId], undefined, { life: toFiniteNumber(stats.Life),
            energyShield: toFiniteNumber(stats.EnergyShield), dps: toFiniteNumber(stats.TotalDPS) }) };
      });
      skillGroups = live.groups;
      buildArchetype = live.archetype;
      liveReadSucceeded = true;
      dataSource = live.isolated ? '已保存构筑，独立引擎计算' : '当前内存构筑';
    } catch (error) {
      if (!buildName) throw error;
      noteIgnoredError('live skill analysis unavailable — use saved XML', error);
    }

    // Fall back to XML if Lua data was unavailable
    if (buildName && !liveReadSucceeded) {
      const build = await context.buildService.readBuild(buildName);

      buildArchetype = inferBuildArchetype(
        build.Build?.className,
        build.Build?.ascendClassName
      );

      // Extract skills from XML
      const skills = asArray(activeSkillSet(build)?.Skill);
      if (skills.length > 0) {
        skillGroups = skills.map((skill, idx: number) => {
          const gems = Array.isArray(skill.Gem) ? skill.Gem : skill.Gem ? [skill.Gem] : [];

          return {
            index: idx + 1,
            label: skill.label,
            slot: skill.slot,
            enabled: skill.enabled !== 'false',
            isMainSkill: idx + 1 === Number(build.Build?.mainSocketGroup),
            gems: gems.map((gem) => ({
              name: gem.nameSpec || gem.name || 'Unknown',
              isSupport: gem.gemId?.includes('SupportGem') || gem.skillId?.startsWith('Support') ? true : gem.gemId?.includes('SkillGem') ? false : undefined,
              level: parseInt(gem.level || '1', 10),
              quality: parseInt(gem.quality || '0', 10),
              enabled: gem.enabled !== 'false',
            })),
          };
        });
      }
    }

    if (skillGroups.length === 0) {
      return {
        content: [
          {
            type: "text" as const,
            text: `数据来源：${dataSource}\n\nNo skill groups found. Add skills to your build first.`,
          },
        ],
      };
    }

    // Analyze skill setup
    const optimization = analyzeSkillSetup(skillGroups, buildArchetype);
    const formatted = formatSkillOptimization(optimization);

    return {
      content: [
        {
          type: "text" as const,
          text: `数据来源：${dataSource}\n\n${formatted}`,
        },
      ],
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to optimize skill links: ${errorMsg}`);
  }
}

/**
 * Create a budget build from scratch based on requirements
 * This is a planning/guidance tool, not a full build generator
 */
export async function handleCreateBudgetBuild(
  context: AdvancedOptimizationContext,
  buildName: string,
  budgetTier: string = 'league-start'
) {
  try {
    // Map budget tier to internal level
    const budgetTierMap: Record<string, 'low' | 'medium' | 'high'> = {
      'league-start': 'low',
      'low': 'low',
      'medium': 'medium',
      'endgame': 'high',
      'high': 'high',
    };
    const budget_level = budgetTierMap[budgetTier] || 'low';

    // Read build info from XML
    const build = await context.buildService.readBuild(buildName);
    const class_name = build.Build?.className || 'Unknown';
    const ascendancy = build.Build?.ascendClassName;

    // The selected main socket group is 1-based within the active skill set.
    let main_skill = 'your main skill';
    const groups = asArray(activeSkillSet(build)?.Skill);
    const groupIndex = Number(build.Build?.mainSocketGroup);
    if (Number.isInteger(groupIndex) && groupIndex > 0) {
      const group = groups[groupIndex - 1];
      const actives = asArray(group?.Gem).filter(g => g.enabled !== 'false' &&
        !g.gemId?.includes('SupportGem') && !g.skillId?.startsWith('Support') &&
        !(g.nameSpec ?? g.name ?? '').toLowerCase().includes('support'));
      const activeIndex = Number(group?.mainActiveSkill ?? 1) - 1;
      const active = actives[activeIndex];
      main_skill = active?.nameSpec || active?.name || main_skill;
    }

    const outputLines: string[] = [
      '=== Budget Build Guide ===',
      '',
      `Build: ${buildName}`,
      `Class: ${class_name}${ascendancy ? ` (${ascendancy})` : ''}`,
      `Main Skill: ${main_skill}`,
      `Budget Tier: ${budgetTier}`,
      '',
      '=== Budget Guidelines ===',
    ];

    if (budget_level === 'low') {
      outputLines.push(
        '- Total budget: < 50 Chaos Orbs',
        '- Use mostly self-found or vendor recipe items',
        '- Focus on life/resistance capped gear first'
      );
    } else if (budget_level === 'medium') {
      outputLines.push(
        '- Total budget: 50-500 Chaos Orbs',
        '- Can afford some build-enabling uniques',
        '- Aim for 5-link main skill'
      );
    } else {
      outputLines.push(
        '- Total budget: 500+ Chaos Orbs',
        '- Access to most uniques and well-rolled rares',
        '- 6-link possible'
      );
    }
    outputLines.push('');

    // Skill setup recommendations
    outputLines.push(
      '=== Recommended Skill Links ===',
      `Main Skill (${budget_level === 'high' ? '6' : budget_level === 'medium' ? '5' : '4'}-link):`,
      `  1. ${main_skill}`,
      '  2. [Damage Support - e.g., Added Fire, Elemental Damage with Attacks]',
      '  3. [Multiplier Support - e.g., Multistrike, Spell Echo]',
      '  4. [Utility Support - e.g., Faster Attacks, Inspiration]'
    );

    if (budget_level !== 'low') {
      outputLines.push('  5. [Penetration or More Damage - e.g., Fire Penetration, Elemental Focus]');
    }
    if (budget_level === 'high') {
      outputLines.push('  6. [Advanced Support - e.g., Exceptional gems, Empower]');
    }
    outputLines.push('');

    // Defensive layers
    outputLines.push(
      '=== Defensive Layers ===',
      '- Aim for 75% all elemental resistances (MANDATORY)',
      '- Target 4000+ life for softcore, 5000+ for hardcore',
      '- Use defensive auras (Determination, Grace, or Defiance Banner)',
      '- Get spell suppression if on right side of tree (Ranger/Shadow)',
      '- Consider block/evasion/armour based on class',
      ''
    );

    // Gearing strategy
    outputLines.push('=== Budget Gearing Strategy ===', '**Weapons:**');
    if (budget_level === 'low') {
      outputLines.push(
        '  - Use vendor recipes or essence crafting',
        '  - For spells: +1 to gems wands/sceptres',
        '  - For attacks: high physical DPS rares'
      );
    } else {
      outputLines.push(
        '  - Budget uniques that enable the build',
        '  - Well-rolled rare weapons with good DPS'
      );
    }
    outputLines.push('**Armor:**');
    if (budget_level === 'low') {
      outputLines.push(
        '  - Prioritize life and resistances',
        '  - Use essences for guaranteed mods',
        '  - Tabula Rasa for temporary 6-link (1 chaos)'
      );
    } else {
      outputLines.push(
        '  - Build-enabling chest uniques if applicable',
        '  - Aim for 5-6 link rare with life and resistances'
      );
    }
    outputLines.push(
      '**Accessories:**',
      '  - Fill in missing resistances',
      '  - Add damage stats where possible',
      '  - Get unique ring/amulet if budget allows',
      ''
    );

    // Passive tree guidance
    outputLines.push(
      '=== Passive Tree Priorities ===',
      '1. Path to key damage clusters for your skill',
      '2. Grab life/ES nodes along the way',
      '3. Get important keystones for your build',
      '4. Fill in jewel sockets if you have good jewels',
      '',
      'Use the `suggest_optimal_nodes` or `get_passive_upgrades` tools for specific recommendations!',
      ''
    );

    // Leveling tips
    outputLines.push(
      '=== Leveling Tips ===',
      `- Level with ${main_skill} or a similar skill if available early`,
      '- Use vendor recipe weapons (magic/rare rustic sash + weapon + whetstone)',
      '- Grab life nodes while leveling, respec for damage later if needed',
      '- Get movement speed boots ASAP',
      "- Don't worry about resistances until Act 5+",
      ''
    );

    // Next steps
    outputLines.push(
      '=== Next Steps ===',
      '1. Use `lua_new_build` to create a new build with this class',
      '2. Use `setup_skill_with_gems` to configure your main skill',
      '3. Use `suggest_optimal_nodes` to get passive tree recommendations',
      '4. Use `add_item` or `add_multiple_items` to equip budget gear',
      '5. Use `analyze_defenses` to check for defensive gaps'
    );
    const output = outputLines.join('\n');

    return {
      content: [
        {
          type: "text" as const,
          text: output,
        },
      ],
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to create budget build plan: ${errorMsg}`);
  }
}
