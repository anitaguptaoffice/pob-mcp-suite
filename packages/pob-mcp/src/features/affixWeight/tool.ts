import type { PoBLuaApiClient } from '../../adapters/pob/bridge.js';

export async function inspectItemAffixWeight(client: Pick<PoBLuaApiClient, 'getItemAffixWeight'>, args: Record<string, unknown>) {
  if (typeof args.mod_id !== 'string' || !args.mod_id.trim() || args.mod_id.length > 200 ||
      typeof args.item_text !== 'string' || !args.item_text.trim() || Buffer.byteLength(args.item_text, 'utf8') > 10240) {
    throw new Error('mod_id and complete item_text (up to 10 KB) are required');
  }
  const result = await client.getItemAffixWeight(args.mod_id.trim(), args.item_text);
  return { source: 'current_pob_item_data', ...result,
    itemLevelAllows: Number.isFinite(result.itemLevel) && Number.isFinite(result.requiredItemLevel) ? result.itemLevel! >= result.requiredItemLevel! : null,
    warnings: [
      'Weight is PoB GetModSpawnWeight for this parsed item and modifier, not a probability and not a guarantee that the modifier is obtainable.',
      'Crafting method, affix conflicts, blocking, item state, special league rules and game-version changes require independent verification.',
      'Item text and modifier ID are caller supplied; this tool does not verify the item or game-data completeness.',
    ] };
}
