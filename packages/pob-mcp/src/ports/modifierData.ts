export type AffixSlot = 'Prefix' | 'Suffix';
export interface ModEntry {
  id: string;
  source: 'explicit' | 'master';
  type: AffixSlot;
  affix: string;
  statLines: string[];
  level: number;
  group: string;
  modTags: string[];
  slotTags: string[];
  allSlotTags: string[];
  weightRules: Array<{ tag: string; weight: number }>;
  itemClasses: string[];
  obtainable: boolean;
}
export interface ModifierDataFile { entries: ModEntry[]; fileName: string; sha256: string }
export interface ModifierDataSource {
  readExplicit(): ModifierDataFile;
  readMaster(): ModifierDataFile;
}
