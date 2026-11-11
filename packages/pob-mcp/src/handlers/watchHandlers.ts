import type { WatchService } from "../services/watchService.js";
import type { BuildService } from "../services/buildService.js";
import type { TreeService } from "../services/treeService.js";
import { wrapHandler } from "../utils/errorHandling.js";

interface WatchHandlerContext {
  watchService: WatchService;
  buildService: BuildService;
  treeService: TreeService;
}

export async function handleRefreshTreeData(context: WatchHandlerContext, version?: string) {
  return wrapHandler('refresh tree data', async () => {
    await context.treeService.refreshTreeData(version);
    return {
      content: [{
        type: "text" as const,
        text: version
          ? `Passive tree data cache cleared for version ${version}.\n\nTree data will be re-fetched on next analysis.`
          : `All passive tree data caches cleared.\n\nTree data will be re-fetched on next analysis.`,
      }],
    };
  });
}
