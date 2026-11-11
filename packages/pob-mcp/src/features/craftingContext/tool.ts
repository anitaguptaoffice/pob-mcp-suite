import type { BuildFoundation } from '../../foundation/buildFoundation.js';
import type { BaseReferenceSource } from '../../ports/baseReferenceSource.js';
import type { FeatureTool } from '../../server/featureRegistry.js';

const fields = ['Life', 'EnergyShield', 'FireResist', 'ColdResist', 'LightningResist', 'ChaosResist', 'TotalDPS', 'CombinedDPS', 'MinionTotalDPS', 'MinionCombinedDPS', 'Armour', 'Evasion'];
const slots = ['Helmet', 'Body Armour', 'Gloves', 'Boots', 'Weapon 1', 'Weapon 2', 'Weapon 1 Swap', 'Weapon 2 Swap', 'Ring 1', 'Ring 2', 'Amulet', 'Belt'];
export function craftingContextSchema(): FeatureTool['schema'] {
  return { name: 'prepare_crafting_context', description: 'Gather explicit item and optional snapshot context for crafting research. Optional PoEDB title verification is not a rules engine, affix eligibility check or probability calculation.', inputSchema: { type: 'object', additionalProperties: false, properties: { snapshot_id: { type: 'string' }, slot: { type: 'string', enum: slots }, base: { type: 'string', minLength: 1, maxLength: 120 }, desired_mods: { type: 'array', maxItems: 20, items: { type: 'string', minLength: 1, maxLength: 200 } }, item_level: { type: 'integer', minimum: 1, maximum: 100 }, budget: { type: 'string', enum: ['low', 'medium', 'high'] }, verify_base: { type: 'boolean' } }, required: ['slot'] } };
}
export function createCraftingContextTool(foundation: Pick<BuildFoundation, 'runReadOnlySnapshot'>, source: BaseReferenceSource): FeatureTool {
  return { schema: craftingContextSchema(), invoke: async args => {
    const snapshot = args.snapshot_id, baseInput = args.base, desired = args.desired_mods ?? [];
    if (Object.keys(args).some(key => !['snapshot_id', 'slot', 'base', 'desired_mods', 'item_level', 'budget', 'verify_base'].includes(key)) || typeof args.slot !== 'string' || !slots.includes(args.slot) || (snapshot !== undefined && (typeof snapshot !== 'string' || !/^[a-f0-9]{64}$/.test(snapshot))) || (baseInput !== undefined && (typeof baseInput !== 'string' || !baseInput.trim() || baseInput.length > 120)) || (!snapshot && !baseInput) || !Array.isArray(desired) || desired.length > 20 || desired.some(x => typeof x !== 'string' || !x.trim() || x.length > 200) || (args.item_level !== undefined && (!Number.isSafeInteger(args.item_level) || (args.item_level as number) < 1 || (args.item_level as number) > 100)) || (args.budget !== undefined && !['low', 'medium', 'high'].includes(args.budget as string)) || (args.verify_base !== undefined && typeof args.verify_base !== 'boolean')) throw new Error('Invalid crafting context options');
    let observation: any = null, equipped: any = null;
    if (snapshot) {
      observation = await foundation.runReadOnlySnapshot(snapshot as string, async engine => ({ items: await engine.getItems(), sets: await engine.listItemSets(), stats: await engine.getStats(fields) }));
      const { items, sets } = observation.result;
      if (!Array.isArray(items) || !sets || !Array.isArray(sets.itemSets) || sets.itemSets.filter((s: any) => s.active === true && s.id === sets.activeItemSetId).length !== 1 || sets.itemSets.filter((s: any) => s.active === true).length !== 1) throw new Error('PoB returned invalid equipment context');
      const matching = items.filter((item: any) => item?.slot === args.slot);
      if (matching.length !== 1 || !Number.isSafeInteger(matching[0].id) || matching[0].id < 0) throw new Error('PoB returned invalid target equipment slot');
      const item = matching[0], activeSet = sets.itemSets.find((s: any) => s.active === true);
      const weapon = /^Weapon [12]( Swap)?$/.exec(args.slot);
      if (weapon && typeof activeSet.useSecondWeaponSet !== 'boolean') throw new Error('PoB returned unknown weapon set');
      const inUse = item.shown === false || (weapon && Boolean(weapon[1]) !== activeSet.useSecondWeaponSet) ? false : item.shown === true ? true : null;
      equipped = { slot: args.slot, itemId: item.id, inUse, name: item.name ?? null, baseName: item.baseName ?? null, rarity: item.rarity ?? null, raw: item.raw ?? null };
    }
    const base = typeof baseInput === 'string' ? baseInput.trim() : equipped?.inUse === true && equipped.itemId > 0 && typeof equipped.baseName === 'string' ? equipped.baseName.trim() : '';
    if (!base) throw new Error('Provide a base or select a visible, active equipped item with a known base');
    let reference: unknown = { status: 'not_requested' };
    if (args.verify_base === true) {
      try { reference = { status: 'verified_title', ...(await source.verify(base)) }; }
      catch (error) { reference = { status: 'unavailable', reason: error instanceof Error ? error.message : String(error) }; }
    }
    const { result: observed, ...context } = observation ?? {};
    return { content: [{ type: 'text', text: JSON.stringify({ context: observation ? context : null, slot: args.slot, base, baseSource: baseInput ? 'provided' : 'equipped', equipped, desiredMods: desired, itemLevel: args.item_level ?? null, budget: args.budget ?? null, buildStats: observed?.stats ?? null, reference,
      warnings: [...(context.warnings ?? []), 'A supplied base, item level, desired modifiers and budget are unverified; the equipped item is context, not proof that a separate target has the same state.', 'A verified page title does not establish modifier eligibility, game-version rules, weight, probability or crafting cost.', 'For an exact international league, use reference_currency_rates separately; reference prices are not executable buyout listings.'] }) }] };
  } };
}
