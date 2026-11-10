import type { PoBLuaApiClient } from '../../pobLuaBridge.js';

export async function compareItem(client: Pick<PoBLuaApiClient, 'compareItem'>, args: Record<string, unknown>) {
  if (typeof args.slot !== 'string' || !args.slot.trim() || typeof args.item_text !== 'string' || !args.item_text.trim() || Buffer.byteLength(args.item_text, 'utf8') > 10240) {
    throw new Error('slot and item_text (up to 10 KB) are required');
  }
  const result = await client.compareItem(args.slot.trim(), args.item_text);
  const delta: Record<string, number> = {};
  for (const [key, value] of Object.entries(result.candidateStats)) {
    const previous = result.baseline[key];
    if (Number.isFinite(value) && Number.isFinite(previous)) delta[key] = value - previous;
  }
  return { source: 'current_live_pob', ...result, delta,
    warnings: [
      'Values use the current build, selected skills and configuration; player and minion damage are separate and must not be summed blindly.',
      'This uses PoB item-preview calculation, does not equip or save the item, and does not verify item legality, trade availability or price.',
      'Candidate quality is preserved as parsed; the result does not assume that quality will be upgraded.',
      'PoB may not recognize every modifier or special item mechanic; inspect the item and PoB version before relying on the result.',
      'Only supported equipment slots are accepted; jewels, flasks and swap slots require separate handling. Check skill sockets, requirements, and any other effects before purchasing.',
    ] };
}
