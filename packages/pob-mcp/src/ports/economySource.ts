/** Source-native snapshots; interpretation and pricing policy belong to callers. */
export type ItemOverviewCategory = 'UniqueWeapon' | 'UniqueArmour' | 'UniqueAccessory' | 'UniqueFlask' | 'UniqueJewel' | 'SkillGem';
export type EconomyQuery = { kind: 'items'; league: string; category: ItemOverviewCategory }
  | { kind: 'currency'; league: string }
  | { kind: 'currency-spread'; league: string };

export interface EconomySnapshot {
  source: 'poe.ninja';
  query: EconomyQuery;
  fetchedAt: string;
  payload: Record<string, unknown>;
}

export interface EconomySource {
  read(query: EconomyQuery): Promise<EconomySnapshot>;
}
