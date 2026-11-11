import type { ModifierDataSource } from '../../ports/modifierData.js';
import { loadModData } from './modDataStore.js';

/** Reads PoB's static modifier tables without starting the PoB calculation engine. */
export class PoBModifierData implements ModifierDataSource {
  readExplicit() { return loadModData('ModExplicit.lua', 'explicit'); }
  readMaster() { return loadModData('ModMaster.lua', 'master'); }
}
