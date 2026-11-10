import type { PoBLuaApiClient } from '../pobLuaBridge.js';
import { BuildMismatchError, loadBuildIfDifferent, readNamedBuild } from './namedBuild.js';
import { resolveBuildFile } from './pathSanitizer.js';
import { noteIgnoredError } from './errorHandling.js';

interface BuildClientContext {
  pobDirectory: string;
  getLuaClient: () => PoBLuaApiClient | null;
  ensureLuaClient: () => Promise<void>;
  createIsolatedLuaClient?: () => Promise<{ client: PoBLuaApiClient; close: () => Promise<void> }>;
}

/** Use the current build when it matches; otherwise use a disposable bridge. */
export async function withBuildClient<T>(context: BuildClientContext, buildName: string | undefined,
  run: (client: PoBLuaApiClient, isolated: boolean) => Promise<T>): Promise<T> {
  await context.ensureLuaClient();
  const current = context.getLuaClient();
  if (!current) throw new Error('Lua client not initialized');
  if (!buildName) return run(current, false);
  let useCurrent = true;
  try {
    await loadBuildIfDifferent(current, buildName, context.pobDirectory);
  } catch (error) {
    if (!(error instanceof BuildMismatchError) || !context.createIsolatedLuaClient) throw error;
    useCurrent = false;
  }
  if (useCurrent) return run(current, false);
  const xml = await readNamedBuild(buildName, context.pobDirectory);
  const isolated = await context.createIsolatedLuaClient!();
  try {
    await isolated.client.loadBuildXml(xml, buildName.replace(/\.xml$/i, ''), resolveBuildFile(buildName, context.pobDirectory));
    return await run(isolated.client, true);
  } finally {
    try { await isolated.close(); } catch (error) { noteIgnoredError('close isolated build bridge', error); }
  }
}
