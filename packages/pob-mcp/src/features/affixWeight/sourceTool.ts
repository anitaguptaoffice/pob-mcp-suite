import type { PoBItemDataSource } from '../../ports/pobItemDataSource.js';
import type { FeatureTool } from '../../server/featureRegistry.js';

export function itemAffixWeightSchema(): FeatureTool['schema'] {
  return { name: 'inspect_pob_item_affix_weight', description: 'Read a modifier spawn weight from PoB item data for explicit item text, without a build snapshot; this is not a crafting probability.', inputSchema: { type: 'object', additionalProperties: false, properties: { mod_id: { type: 'string' }, item_text: { type: 'string' } }, required: ['mod_id', 'item_text'] } };
}
export function createItemAffixWeightTool(source: PoBItemDataSource): FeatureTool {
  return { schema: itemAffixWeightSchema(), invoke: async args => {
    if (Object.keys(args).some(key => !['mod_id', 'item_text'].includes(key)) || typeof args.mod_id !== 'string' || !args.mod_id.trim() || args.mod_id.length > 200 || typeof args.item_text !== 'string' || !args.item_text.trim() || Buffer.byteLength(args.item_text, 'utf8') > 10240) throw new Error('Valid modifier ID and item text up to 10 KB are required');
    const modId = args.mod_id.trim(), { result, identity } = await source.weight(modId, args.item_text);
    if (!result || result.modId !== modId || typeof result.base !== 'string' || !result.base || typeof result.weight !== 'number' || !Number.isFinite(result.weight) || result.weight < 0) throw new Error('PoB returned invalid affix data');
    const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
    const itemLevelAllows = finite(result.itemLevel) && finite(result.requiredItemLevel) ? result.itemLevel >= result.requiredItemLevel : null;
    const identityUnknown = ['engineVersion', 'adapterVersion', 'dataVersion', 'runtimeVersion', 'executableVersion'].filter(key => !identity[key as keyof typeof identity]);
    return { content: [{ type: 'text', text: JSON.stringify({ source: 'pob_item_data', ...result, itemLevelAllows, identity, identityUnknown,
      warnings: ['PoB spawn weight is not a crafting probability or proof of item legality, eligibility or availability.', 'Item text and modifier ID are caller supplied. Crafting method, existing modifiers, special item rules and current game data require separate verification.', 'Identity fingerprints do not cover external dependencies or transient changes between checks.', ...(identityUnknown.length ? ['Some engine or data identities are unknown; version compatibility cannot be established.'] : [])] }) }] };
  } };
}
