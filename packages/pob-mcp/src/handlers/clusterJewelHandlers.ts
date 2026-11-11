import { CLUSTER_NOTABLE_TAGS, inferClusterArchetype } from '../domain/clusterHeuristics.js';
/**
 * Cluster Jewel Trade Handlers
 *
 * Specialized handlers for searching and analyzing cluster jewels
 */

import { wrapHandler } from '../utils/errorHandling.js';
import type { PoBLuaApiClient } from '../adapters/pob/bridge.js';
import type { PoBItemEntry, PoBBuild } from '../types.js';

interface ParsedClusterJewel {
  slot: string | undefined;
  rarity: string;
  name: string;
  baseType: string;
  itemLevel: number;
  passiveCount: number | null;
  size?: 'Large' | 'Medium' | 'Small';
  enchantments: string[];
  notables: string[];
  mods: string[];
}

export async function handleAnalyzeClusterJewels(
  context: { buildService: { readBuild: (name: string) => Promise<PoBBuild> } },
  args: {
    build_name: string;
  }
): Promise<{
  content: Array<{
    type: string;
    text: string;
  }>;
}> {
  return wrapHandler('analyze cluster jewels', async () => {
    const { build_name } = args;

    // Read the build
    const build = await context.buildService.readBuild(build_name);

    // Find cluster jewels in the build
    const clusterJewels = findClusterJewelsInBuild(build);

    if (clusterJewels.length === 0) {
      return {
        content: [
          {
            type: 'text',
            text: `No cluster jewels found in build "${build_name}".`,
          },
        ],
      };
    }

    // Format the analysis
    let output = `=== Cluster Jewel Analysis: ${build_name} ===\n\n`;
    output += `Found ${clusterJewels.length} cluster jewel${clusterJewels.length > 1 ? 's' : ''}:\n\n`;

    for (let i = 0; i < clusterJewels.length; i++) {
      const jewel = clusterJewels[i];
      output += formatClusterJewelAnalysis(jewel, i + 1);
      output += '\n';
    }

    return {
      content: [
        {
          type: 'text',
          text: output,
        },
      ],
    };
  });
}

/**
 * Find cluster jewels in a PoB build.
 * readBuild() returns the PathOfBuilding element already UNWRAPPED, and tree
 * jewels are NOT inside any gear ItemSet — their rendered text lives in
 * Items/Item regardless of which set is equipped. Iterating Items/Item is
 * both the correct and the only navigation needed.
 */
function findClusterJewelsInBuild(build: PoBBuild): ParsedClusterJewel[] {
  const clusterJewels: ParsedClusterJewel[] = [];

  const rawItems = build?.Items?.Item;
  if (!rawItems) return clusterJewels;
  const itemList = Array.isArray(rawItems) ? rawItems : [rawItems];

  for (const item of itemList) {
    if (!item || !item['#text']) continue;

    const itemText: string = item['#text'];
    if (itemText.includes('Cluster Jewel')) {
      clusterJewels.push(parseClusterJewelItem(item, itemText));
    }
  }

  return clusterJewels;
}

/**
 * Parse a cluster jewel item from PoB format
 */
function parseClusterJewelItem(item: PoBItemEntry, itemText: string): ParsedClusterJewel {
  const lines = itemText.split('\n');

  const jewel: ParsedClusterJewel = {
    slot: item.id,
    rarity: 'Unknown',
    name: '',
    baseType: '',
    itemLevel: 0,
    passiveCount: null,
    enchantments: [],
    notables: [],
    mods: [],
  };

  let currentSection = 'header';

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Parse rarity
    if (trimmed.startsWith('Rarity:')) {
      jewel.rarity = trimmed.replace('Rarity:', '').trim();
      continue;
    }

    // Parse name and base type
    if (currentSection === 'header' && !trimmed.startsWith('Rarity:')) {
      if (!jewel.name) {
        jewel.name = trimmed;
      } else if (trimmed.includes('Cluster Jewel')) {
        jewel.baseType = trimmed;

        // Extract size from base type
        if (trimmed.includes('Large')) jewel.size = 'Large';
        else if (trimmed.includes('Medium')) jewel.size = 'Medium';
        else if (trimmed.includes('Small')) jewel.size = 'Small';

        currentSection = 'properties';
      }
      continue;
    }

    // Parse item level
    if (trimmed.startsWith('Item Level:')) {
      jewel.itemLevel = parseInt(trimmed.replace('Item Level:', '').trim(), 10);
      continue;
    }

    // Parse passive count
    if (trimmed.match(/Adds \d+ Passive Skills?/)) {
      const match = trimmed.match(/Adds (\d+) Passive Skills?/);
      if (match) {
        jewel.passiveCount = parseInt(match[1], 10);
      }
      continue;
    }

    // Parse enchantments (these contain "Added Small Passive Skills grant:")
    if (trimmed.includes('Added Small Passive Skills grant:') || trimmed.includes('Added Passive Skills are:')) {
      jewel.enchantments.push(trimmed);
      continue;
    }

    // Parse notables (lines containing "Allocates")
    if (trimmed.includes('Allocates')) {
      const match = trimmed.match(/Allocates (.+)/);
      if (match) {
        jewel.notables.push(match[1]);
      }
      continue;
    }

    // Other explicit mods
    if (trimmed.startsWith('+') || trimmed.startsWith('-') || trimmed.match(/^\d+%/)) {
      jewel.mods.push(trimmed);
    }
  }

  return jewel;
}

/**
 * Format cluster jewel analysis output
 */
function formatClusterJewelAnalysis(jewel: ParsedClusterJewel, index: number): string {
  let output = `${index}. ${jewel.name || jewel.baseType}\n`;
  output += `   Base: ${jewel.baseType}\n`;
  output += `   Rarity: ${jewel.rarity}\n`;
  output += `   Item Level: ${jewel.itemLevel}\n`;

  if (jewel.passiveCount) {
    output += `   Passive Skills: Adds ${jewel.passiveCount}\n`;
  }

  if (jewel.enchantments.length > 0) {
    output += `   Enchantments:\n`;
    for (const enchant of jewel.enchantments) {
      output += `     • ${enchant}\n`;
    }
  }

  if (jewel.notables.length > 0) {
    output += `   Notables:\n`;
    for (const notable of jewel.notables) {
      output += `     ⭐ ${notable}\n`;
    }
  }

  if (jewel.mods.length > 0) {
    output += `   Other Mods:\n`;
    for (const mod of jewel.mods) {
      output += `     • ${mod}\n`;
    }
  }

  return output;
}

// ---------------------------------------------------------------------------
// Build Cluster Jewel Analyzer — evaluates EQUIPPED cluster jewels
// ---------------------------------------------------------------------------

interface ClusterJewelBuildContext {
  getLuaClient: () => PoBLuaApiClient | null;
  ensureLuaClient: () => Promise<void>;
}

export async function handleAnalyzeBuildClusterJewels(context: ClusterJewelBuildContext) {
  await context.ensureLuaClient();
  const luaClient = context.getLuaClient();
  if (!luaClient) throw new Error('Lua bridge not active. Use lua_load_build first.');

  const items = await luaClient.getItems();
  const clusterJewels = items.filter((item) => {
    // PoB's field is `baseName` (get_items maps it.baseName); the previous
    // `item.base` was always undefined → this filter matched NOTHING and
    // the tool always reported "No cluster jewels detected".
    const base: string = item.baseName || '';
    if (!
      (base.includes('Cluster Jewel') ||
       base.includes('Large Jewel') ||
       base.includes('Medium Jewel') ||
       base.includes('Small Jewel'))
    ) return false;
    // Socketed passive-tree jewels arrive as "Amber Watcher [Large Cluster
    // Jewel]" in name — accept that too; socket slot naming is PoB-version
    // dependent and must not be the only accept path.
    const nameIsJewel = /\[[^\]]*Jewel[^\]]*\]/.test(item.name || '');
    const slotIsJewel = String(item.slot).toLowerCase().includes('jewel');
    return nameIsJewel || slotIsJewel;
  });

  if (clusterJewels.length === 0) {
    return {
      content: [{
        type: 'text' as const,
        text: '=== Cluster Jewel Analysis ===\n\nNo cluster jewels detected in equipped items.\nEnsure a build with cluster jewels is loaded.',
      }],
    };
  }

  // Detect build archetype from skills
  const skills = await luaClient.getSkills();
  const gemNames: string[] = [];
  for (const group of (skills?.groups ?? [])) {
    for (const gem of (group.gems ?? [])) gemNames.push(gem.name);
  }
  const archetypeTags = inferClusterArchetype(gemNames);

  let output = '=== Cluster Jewel Analysis ===\n';
  output += `**Build Archetype Tags:** ${archetypeTags.join(', ')}\n\n`;

  for (const jewel of clusterJewels) {
    const raw: string = jewel.raw || '';
    output += `### ${jewel.name || jewel.baseName} (${jewel.slot})\n`;
    output += `Base: ${jewel.baseName}\n`;

    // Find any known notable names mentioned in the raw item text
    const foundNotables = Object.keys(CLUSTER_NOTABLE_TAGS).filter(n => raw.includes(n));

    if (foundNotables.length > 0) {
      output += `Notables:\n`;
      for (const notable of foundNotables) {
        const tags = CLUSTER_NOTABLE_TAGS[notable] ?? [];
        const relevant = tags.some(t => archetypeTags.includes(t));
        const icon = relevant ? '✅' : '⚠️';
        output += `  ${icon} ${notable} [${tags.join(', ')}]${relevant ? '' : ' — may not synergize with your build archetype'}\n`;
      }
    } else {
      output += `  (Could not parse notables — ensure item raw text contains notable names)\n`;
    }
    output += '\n';
  }

  output += `_To search for better cluster jewels, use \`search_cluster_listings\` with the trade API._\n`;

  return { content: [{ type: 'text' as const, text: output }] };
}
