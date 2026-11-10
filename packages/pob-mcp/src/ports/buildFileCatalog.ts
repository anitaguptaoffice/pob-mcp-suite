export interface BuildFileCatalogResult {
  directory: string;
  names: string[];
  complete: boolean;
  issues: Array<{ path: string; reason: string }>;
}
export interface BuildFileCatalog { scan(): Promise<BuildFileCatalogResult> }
