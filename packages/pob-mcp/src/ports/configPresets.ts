export type ConfigValues = Record<string, string | number | boolean>;
export type EnemyLevelSetting = { mode: 'automatic' } | { mode: 'explicit'; value: number };
export interface ConfigPreset {
  name: string;
  config: ConfigValues;
  sourceSnapshotId: string;
  sourceIdentity: Record<string, string | null>;
  savedAt: string;
  enemyLevelSetting: EnemyLevelSetting;
}
export interface ConfigPresetStore {
  list(): Promise<Array<{ name: string }>>;
  read(name: string): Promise<ConfigPreset>;
  save(preset: ConfigPreset, overwrite: boolean): Promise<void>;
}
