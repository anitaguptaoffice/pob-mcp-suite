import { statCategoryFields } from '../../domain/statCategories.js';
import type { BuildFoundation, EvaluationOptions } from '../../foundation/buildFoundation.js';
import type { FeatureTool } from '../../server/featureRegistry.js';

export function statCategoriesSchema(): FeatureTool['schema'] {
  return { name: 'evaluate_snapshot_stat_category', description: 'Calculate a bounded offense, defense or combined set of PoB metrics for one snapshot. Player, minion and full damage remain separate; unknown values are explicit.', inputSchema: { type: 'object', additionalProperties: false, properties: {
    snapshot_id: { type: 'string' }, category: { type: 'string', enum: ['offense', 'defense', 'all'] },
    selection: { type: 'object', additionalProperties: false, properties: { mainSocketGroup: { type: 'integer', minimum: 1 }, mainActiveSkill: { type: 'integer', minimum: 1 }, skillPart: { type: 'integer', minimum: 1 } } },
    config: { type: 'object', additionalProperties: { type: ['string', 'number', 'boolean'] } },
  }, required: ['snapshot_id', 'category'] } };
}

export function createStatCategoriesTool(foundation: Pick<BuildFoundation, 'evaluate'>): FeatureTool {
  return { schema: statCategoriesSchema(), invoke: async args => {
    if (Object.keys(args).some(key => !['snapshot_id', 'category', 'selection', 'config'].includes(key)) || typeof args.snapshot_id !== 'string' || !/^[a-f0-9]{64}$/.test(args.snapshot_id) || !['offense', 'defense', 'all'].includes(args.category as string)) throw new Error('Valid snapshot and stat category are required');
    const category = args.category as 'offense' | 'defense' | 'all';
    const fields = statCategoryFields(category);
    const evaluation = await foundation.evaluate(args.snapshot_id, fields, { ...(args.selection === undefined ? {} : { selection: args.selection as EvaluationOptions['selection'] }), ...(args.config === undefined ? {} : { config: args.config as EvaluationOptions['config'] }) });
    return { content: [{ type: 'text', text: JSON.stringify({ ...evaluation, category, fields,
      warnings: [...evaluation.warnings, 'The category is a bounded field list, not every PoB output. Raw stats may include additional minion fields returned by PoB. Values depend on the displayed skill and configuration context.', 'Player, minion and full damage can overlap; do not sum them without checking PoB mechanics.', 'Unknown metrics are not zero; zero values may be meaningful.'] }) }] };
  } };
}
