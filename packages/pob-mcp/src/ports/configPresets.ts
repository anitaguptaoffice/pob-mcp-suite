export type ConfigValues = Record<string, string | number | boolean>;
export type PresetOrigin = 'versioned' | 'legacy';
export interface ConfigPreset {
  name: string;
  origin: PresetOrigin;
  config: ConfigValues;
  sourceSnapshotId: string | null;
  sourceIdentity: Record<string, string | null> | null;
  savedAt: string | null;
}
export interface ConfigPresetStore {
  list(): Promise<Array<{ name: string; origins: PresetOrigin[] }>>;
  read(name: string, origin?: PresetOrigin): Promise<ConfigPreset>;
  save(preset: ConfigPreset, overwrite: boolean): Promise<void>;
}
