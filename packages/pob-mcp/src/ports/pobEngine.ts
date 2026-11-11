import type { EnemyLevelSetting } from './configPresets.js';

export interface BridgeCapabilities { mode?: string; adapter?: string; actions?: string[]; capabilitiesReported?: boolean }
export interface ItemParseDiagnostics { available: boolean; unparsed: Array<{ group: string; line: string; extra: string; active?: boolean }> }
export interface AilmentReport {
  name: string; chanceOnHit: number; chanceOnCrit: number; effectMod?: number; duration?: number; minimumEffect?: number; maximumEffect?: number;
  appliedEffect: number; calculatedEffect?: number; landsOnConfiguredEnemy?: boolean; creditedInCalc: boolean;
  effectConfigVar?: string; enabledConfigVar?: string; enabledOnEnemy?: boolean;
  thresholdTable?: Array<{ ailmentThreshold: number; effect: number; note?: string; isConfiguredEnemy?: boolean }>;
}
export interface AnointQuery { slot: string; focus?: 'dps' | 'defence' | 'both'; limit?: number; enchantSlot?: number; damageMetric?: 'CombinedDPS' | 'TotalDPS' | 'MinionCombinedDPS' | 'MinionTotalDPS' }
export interface AnointResult {
  candidates: Array<{ nodeId: number | string; name: string; dpsDelta: number; ehpDelta: number; score: number; recipe?: string[] }>;
  base: { CombinedDPS: number; TotalEHP: number; damageStat?: string; damageValue?: number; ehpAvailable?: boolean }; evaluated: number; skipped: number; slot: string; enchantSlot: number; selectedEnchant?: string; baseType: string; focus: string;
}
export interface ItemComparison { slot: string; candidate: { name?: string; base?: string; quality?: number }; baseline: Record<string, number>; candidateStats: Record<string, number>; parseDiagnostics?: { current: ItemParseDiagnostics; candidate: ItemParseDiagnostics } }
export interface TimelessQuery { socketNodeId: number; desired: string[]; limit?: number; seeds?: number[]; historicFigure?: string; keystoneNodeId?: number; requiredSourceNodeIds?: number[] }
export interface TimelessResult { socketNodeId: number; treeVersion: string; jewelType: string; scannedSeeds: number; totalMatches: number; results: unknown[] }

/** The adapter owns a disposable PoB instance; it must never share live state. */
export interface BuildEngine {
  inspectItemParse(itemText: string): Promise<unknown>;
  getClusterJewels(): Promise<unknown>;
  newBuild(params?: { className: string; ascendancy?: string; treeVersion?: string }): Promise<unknown>;
  getCapabilities(): Promise<BridgeCapabilities>;
  getAilments(): Promise<{ ailments: AilmentReport[]; calculationSelectionMatchesMain?: boolean }>;
  getEnemyLevelSetting(): Promise<EnemyLevelSetting>;
  evaluateAnointCandidates(params: AnointQuery): Promise<AnointResult>;
  queryTreePaths(params: { targetNodeId?: number; maxDistance?: number; limit?: number; filter?: string; allocatedOnly?: boolean }): Promise<unknown>;
  getBuildNotes(): Promise<string>;
  setBuildNotes(notes: string): Promise<void>;
  identity: { engineVersion: string | null; adapterVersion: string | null; dataVersion: string | null; runtimeVersion?: string | null; executableVersion?: string | null };
  verifyIdentity(): Promise<void>;
  loadBuildXml(xml: string): Promise<unknown>;
  getStats(fields?: string[]): Promise<unknown>;
  setLevel(level: number): Promise<void>;
  setMainSelection(selection: { mainSocketGroup?: number; mainActiveSkill?: number; skillPart?: number }): Promise<void>;
  setCalcsSelection(groupIndex: number): Promise<void>;
  setConfig(config: Record<string, string | number | boolean>): Promise<{ rejected: Record<string, string>; applied?: Record<string, unknown> }>;
  getBuildInfo(): Promise<{ level?: number; treeVersion?: string; targetVersion?: string }>;
  captureSnapshot(): Promise<{ xml: string }>;
  getTree(): Promise<unknown>;
  refreshTreeProgress(): Promise<void>;
  updateTreeDelta(params: { addNodes: number[]; removeNodes: number[]; masteryEffects?: Record<string, number> }): Promise<{ tree: unknown; droppedNodes?: number[] }>;
  deallocateTreeNode?(nodeId: number): Promise<{ tree: unknown; expectedRemoved: number[] }>;
  setTree(params: { classId: number; ascendClassId: number; secondaryAscendClassId: number; nodes: number[]; masteryEffects: Record<string, number>; treeVersion: string }, preserveOverrides?: boolean): Promise<unknown>;
  getTreeOverrides?(): Promise<unknown>;
  generateWeightedTradeQuery?(slot: string, options: Record<string, unknown>): Promise<{ query: unknown; warning?: string; weightBaselines: unknown }>;
  getMasteryNodeOptions(nodeId: number): Promise<{ nodeId: number; nodeName: string; allocated: boolean; allocatedEffect?: number; ascendancyName?: string; availableEffects: Array<{ effectId: number; stat: string }> }>;
  getMasteryOptions(): Promise<{ masteries: Array<{ nodeId: number | string; nodeName?: string; allocatedEffect?: number; availableEffects: Array<{ effectId: number; stat?: string }> }> }>;
  searchNodes(params: { keyword: string; nodeType?: string; maxResults: number; includeAllocated: boolean }): Promise<{ nodes: unknown[]; count: number }>;
  getItems(): Promise<unknown>;
  addItem(itemText: string, slot?: string, noAutoEquip?: boolean): Promise<{ id: number; slot?: string }>;
  getItemInventory?(): Promise<Array<{ id: number; raw: string }>>;
  getItemAffixWeight(modId: string, itemText: string): Promise<{ modId: string; base: string; weight: number; itemLevel?: number; requiredItemLevel?: number; affixType?: string; affixGroup?: string }>;
  getSkills(): Promise<unknown>;
  setGemLevel(params: { groupIndex: number; gemIndex: number; level: number }): Promise<void>;
  setGemQuality(params: { groupIndex: number; gemIndex: number; quality: number; qualityId?: string }): Promise<void>;
  setGemEnabled(params: { groupIndex: number; gemIndex: number; enabled: boolean }): Promise<void>;
  addGem(params: { groupIndex: number; gemName: string; level?: number; quality?: number; enabled?: boolean; count?: number; enableGlobal1?: boolean; enableGlobal2?: boolean; insertIndex?: number }): Promise<{ gemIndex: number; name?: string }>;
  removeGem(params: { groupIndex: number; gemIndex: number }): Promise<void>;
  createSocketGroup(params: { label?: string; slot?: string; enabled?: boolean; includeInFullDPS?: boolean }): Promise<{ index: number; label?: string }>;
  setSocketGroupEnabled(params: { groupIndex: number; enabled: boolean }): Promise<{ groupIndex: number; enabled: boolean }>;
  removeSkill(params: { groupIndex: number }): Promise<void>;
  setFlaskActive(index: number, active: boolean): Promise<void>;
  listItemSets(): Promise<{ activeItemSetId: number; itemSets: Array<{ id: number; title: string; active: boolean; useSecondWeaponSet: boolean }> }>;
  selectItemSet(id: number): Promise<{ activeItemSetId: number; itemSets: Array<{ id: number; title: string; active: boolean; useSecondWeaponSet: boolean }> }>;
  listSpecs(): Promise<{ activeSpec: number; specs: Array<{ index: number; title: string; active: boolean; className?: string; ascendClassName?: string; treeVersion?: string; nodeCount: number }> }>;
  selectSpec(index: number): Promise<{ activeSpec: number; specs: Array<{ index: number; title: string; active: boolean; className?: string; ascendClassName?: string; treeVersion?: string; nodeCount: number }> }>;
  createSpec(params: { title?: string; copyFrom?: number; activate?: boolean }): Promise<unknown>;
  renameSpec(index: number, title: string): Promise<unknown>;
  deleteSpec(index: number): Promise<unknown>;
  compareItem(slot: string, itemText: string): Promise<ItemComparison>;
  findTimelessJewelSeedsDetailed(params: TimelessQuery): Promise<TimelessResult>;
  getCompatibleSupports(params: { groupIndex?: number; query?: string; limit?: number; includeExceptional?: boolean }): Promise<{
    groupIndex: number; skillName?: string; candidates: Array<{ id: string; name: string; exceptional: boolean; alreadySocketed: boolean }>;
    total: number; failed: number;
  }>;
  getConfig(): Promise<unknown>;
  close(): Promise<void>;
}
