import type { ToolSchema } from '../../server/toolSchema.js';
import { compareCraftBudget, type CraftScenario } from './model.js';

export function craftBudgetSchemas(): ToolSchema[] {
  return [{ name: 'compare_craft_budget', description: 'Compare buying with a geometric repeat-attempt crafting cost model. Requires externally verified per-attempt success probabilities and complete per-attempt costs supplied by the caller. This tool does not simulate PoE crafting mechanics or discover probabilities.',
    inputSchema: { type: 'object', properties: {
      buy_chaos: { type: 'number', description: 'Optional comparable purchase price in chaos.' },
      scenarios: { type: 'array', items: { type: 'object', properties: {
        name: { type: 'string' }, success_probability: { type: 'number', description: 'Verified single-attempt probability from 0 exclusive to 1 inclusive.' },
        chaos_per_attempt: { type: 'number', description: 'Explicit all-in cost per attempt in chaos; state excluded costs.' },
        probability_source: { type: 'string', description: 'Source, game version and assumptions for the probability.' },
      }, required: ['name', 'success_probability', 'chaos_per_attempt', 'probability_source'] } },
    }, required: ['scenarios'] },
  }];
}

export function handleCraftBudget(args: Record<string, unknown>) {
  if (!Array.isArray(args.scenarios)) throw new Error('scenarios is required');
  const scenarios: CraftScenario[] = args.scenarios.map(value => {
    if (!value || typeof value !== 'object') throw new Error('invalid scenario');
    const v = value as Record<string, unknown>;
    return { name: v.name as string, successProbability: v.success_probability as number, chaosPerAttempt: v.chaos_per_attempt as number, probabilitySource: v.probability_source as string };
  });
  const report = compareCraftBudget(scenarios, args.buy_chaos as number | undefined);
  return { content: [{ type: 'text' as const, text: JSON.stringify(report, null, 2) }] };
}
