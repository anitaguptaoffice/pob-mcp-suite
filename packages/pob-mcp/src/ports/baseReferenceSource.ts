export interface BaseReferenceSource {
  verify(base: string): Promise<{ source: 'poedb'; base: string; englishUrl: string; chineseUrl: string }>;
}
