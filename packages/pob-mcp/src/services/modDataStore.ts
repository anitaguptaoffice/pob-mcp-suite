import * as source from "../adapters/modifierData/modDataStore.js";
export type { AffixSlot, ModEntry } from "../ports/modifierData.js";
export const ModDataUnavailableError = source.ModDataUnavailableError;
export const parseModFile = (...args: Parameters<typeof source.parseModFile>) => source.parseModFile(...args);
export const parseWatchersEyeFile = (...args: Parameters<typeof source.parseWatchersEyeFile>) => source.parseWatchersEyeFile(...args);
export const loadModData = (...args: Parameters<typeof source.loadModData>) => source.loadModData(...args);
export const loadExplicitMods = () => source.loadExplicitMods();
export const loadMasterMods = () => source.loadMasterMods();
export const loadAllMods = () => source.loadAllMods();
