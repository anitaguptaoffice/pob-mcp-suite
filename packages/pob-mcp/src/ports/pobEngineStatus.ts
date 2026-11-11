export interface PoBEngineStatusSource {
  inspect(): Promise<{ identity: { engineVersion: string | null; adapterVersion: string | null; dataVersion: string | null; runtimeVersion?: string | null; executableVersion?: string | null }; capabilities: { mode?: string; adapter?: string; capabilitiesReported?: boolean; actions?: string[] } }>;
}
