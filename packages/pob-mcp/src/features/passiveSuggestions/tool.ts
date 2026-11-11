import type { BuildFoundation } from '../../foundation/buildFoundation.js';
import type { FeatureTool } from '../../server/featureRegistry.js';

const goalKeywords: Record<string, string[]> = {
  damage: ['damage', 'critical', 'elemental', 'spell'],
  dps: ['damage', 'critical', 'cast speed'],
  defense: ['life', 'armour', 'evasion', 'block', 'energy shield'],
  life: ['life', 'maximum life', 'life regeneration'],
  es: ['energy shield', 'maximum energy shield'],
  resist: ['resistance', 'elemental resistance'],
  speed: ['attack speed', 'cast speed', 'movement speed'],
};

export function passiveSuggestionsSchema(): FeatureTool['schema'] {
  return { name: 'find_snapshot_passive_suggestions', description: 'Find unallocated notable and keystone candidates by goal keywords on the snapshot tree. Keyword matches are not calculated gains or verified paths.', inputSchema: { type: 'object', additionalProperties: false, properties: { snapshot_id: { type: 'string' }, goal: { type: 'string', minLength: 1, maxLength: 100 }, limit: { type: 'integer', minimum: 1, maximum: 30 } }, required: ['snapshot_id', 'goal'] } };
}

export function createPassiveSuggestionsTool(foundation: Pick<BuildFoundation, 'runReadOnlySnapshot'>): FeatureTool {
  return { schema: passiveSuggestionsSchema(), invoke: async args => {
    if (Object.keys(args).some(key => !['snapshot_id', 'goal', 'limit'].includes(key)) || typeof args.snapshot_id !== 'string' || !/^[a-f0-9]{64}$/.test(args.snapshot_id) || typeof args.goal !== 'string' || !args.goal.trim() || args.goal.length > 100 || (args.limit !== undefined && (!Number.isInteger(args.limit) || (args.limit as number) < 1 || (args.limit as number) > 30))) throw new Error('Invalid passive suggestion options');
    const goal = args.goal.trim().toLowerCase();
    const limit = (args.limit ?? 10) as number;
    const { result, ...context } = await foundation.runReadOnlySnapshot(args.snapshot_id, async engine => {
      const tree = await engine.getTree() as { treeVersion?: unknown };
      if (!tree || typeof tree.treeVersion !== 'string' || !tree.treeVersion) throw new Error('PoB returned invalid tree version');
      const skills = await engine.getSkills() as { groups?: unknown };
      if (!skills || !Array.isArray(skills.groups)) throw new Error('PoB returned invalid skill groups');
      const names: string[] = [];
      for (const group of skills.groups) {
        if (!group || typeof group !== 'object' || !Array.isArray(group.gems)) throw new Error('PoB returned invalid skill group');
        for (const gem of group.gems) if (typeof gem?.name === 'string') names.push(gem.name.toLowerCase());
      }
      const gemText = names.join(' ');
      const archetypes = [
        ['minion', ['minion', 'summon', 'golem', 'skeleton', 'zombie']],
        ['lightning', ['lightning', 'thunder', 'storm', 'arc ']],
        ['fire', ['fire', 'flame', 'ignite', 'burning']],
        ['cold', ['cold', 'ice', 'freeze', 'frost']],
        ['chaos', ['chaos', 'poison', 'blight']],
        ['spell', ['spell', 'arcane', 'cast']],
      ] as const;
      const inferred = archetypes.filter(([, terms]) => terms.some(term => gemText.includes(term))).map(([name]) => name as string);
      if (!gemText.includes('summon') && !gemText.includes('minion') && ['strike', 'slash', 'attack'].some(term => gemText.includes(term))) inferred.push('attack');
      const defaults = Object.hasOwn(goalKeywords, goal) ? goalKeywords[goal] : undefined;
      const keywords = goal === 'damage' && inferred.length ? [...inferred.map(name => `${name} damage`), 'damage', 'critical'] : goal === 'dps' && inferred.length ? [...inferred, 'cast speed', 'critical'] : defaults ?? (inferred.length ? [...inferred, goal] : [goal]);
      const searches = [...keywords.slice(0, 3).map(keyword => ({ keyword, nodeType: 'notable', maxResults: 10 })), { keyword: keywords[0], nodeType: 'keystone', maxResults: 5 }];
      const results = [];
      for (const search of searches) {
        const found = await engine.searchNodes({ ...search, includeAllocated: false });
        if (!found || !Array.isArray(found.nodes) || !Number.isSafeInteger(found.count) || found.count !== found.nodes.length || found.count > search.maxResults) throw new Error('PoB returned invalid passive suggestions');
        for (const item of found.nodes) {
          const node = item as Record<string, unknown>;
          if (!node || typeof node !== 'object' || !Number.isSafeInteger(node.id) || (node.id as number) < 1 || typeof node.name !== 'string' || node.type !== search.nodeType || node.allocated !== false || !Array.isArray(node.stats) || node.stats.some(stat => typeof stat !== 'string')) throw new Error('PoB returned invalid passive suggestion node');
        }
        results.push({ ...search, nodes: found.nodes, returnedCount: found.count, possiblyTruncated: found.count === search.maxResults });
      }
      return { treeVersion: tree.treeVersion, inferred, results };
    });
    const unique = new Map<number, { node: unknown; matchedKeywords: string[] }>();
    for (const search of result.results) for (const item of search.nodes) {
      const node = item as { id: number };
      const existing = unique.get(node.id);
      if (existing) { if (!existing.matchedKeywords.includes(search.keyword)) existing.matchedKeywords.push(search.keyword); }
      else unique.set(node.id, { node, matchedKeywords: [search.keyword] });
    }
    const candidates = [...unique.values()];
    return { content: [{ type: 'text', text: JSON.stringify({ ...context, treeVersion: result.treeVersion, goal, inferredArchetypes: result.inferred, searches: result.results.map(({ nodes, ...info }) => info), candidates: candidates.slice(0, limit), returnedCount: Math.min(candidates.length, limit), outputTruncated: candidates.length > limit, warnings: [...context.warnings, 'Keyword and gem-name matches are heuristics, including disabled gems; they do not establish relevance, gain, path reachability, point cost or legality.', 'Each search is bounded and unordered; reaching its limit may omit candidates. Use PoB paths and explicit calculation to evaluate candidates.'] }) }] };
  } };
}
