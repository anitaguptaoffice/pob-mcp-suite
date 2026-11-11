export interface WatchersEyeSource {
  read(): { source: 'pob_watchers_eye'; sha256: string; entries: Array<{ id: string; lines: string[] }> };
}
