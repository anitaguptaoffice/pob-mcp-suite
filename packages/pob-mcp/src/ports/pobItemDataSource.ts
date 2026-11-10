export interface PoBItemDataSource {
  weight(modId: string, itemText: string): Promise<{ result: { modId: string; base: string; weight: number; itemLevel?: number; requiredItemLevel?: number; affixType?: string; affixGroup?: string }; identity: { engineVersion: string | null; adapterVersion: string | null; dataVersion: string | null; runtimeVersion?: string | null; executableVersion?: string | null } }>;
}
