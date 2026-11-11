export interface UpstreamTreeSnapshot {
  source: 'pob-upstream-github';
  treeVersion: string;
  url: string;
  fetchedAt: string;
  sha256: string;
  bytes: number;
  text: string;
}
export interface UpstreamTreeSource {
  read(treeVersion: string, refresh?: boolean): Promise<UpstreamTreeSnapshot>;
}
