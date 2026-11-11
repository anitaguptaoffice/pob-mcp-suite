import { findCraftableMods as queryCraftable, findAffixTiers as queryTiers } from "../domain/modifiers/affixQuery.js";
import type { CraftableQuery, TierQuery } from "../domain/modifiers/affixQuery.js";
import { loadExplicitMods, loadMasterMods } from "./modDataStore.js";
export { firstMatchingSpawnRule } from "../domain/modifiers/affixQuery.js";
export type { CraftableQuery, CraftableResult, TierQuery, TierResult } from "../domain/modifiers/affixQuery.js";
export const findCraftableMods = (query: CraftableQuery, entries = loadMasterMods()) => queryCraftable(query, entries);
export const findAffixTiers = (query: TierQuery, entries = loadExplicitMods()) => queryTiers(query, entries);
