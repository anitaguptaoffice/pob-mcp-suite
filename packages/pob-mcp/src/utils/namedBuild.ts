import fs from "fs/promises";
import { resolveBuildFile } from "./pathSanitizer.js";

/**
 * Read a named build, failing loudly when it does not exist.
 *
 * Swallowing the miss and continuing with whatever the Lua bridge holds reports
 * another build's numbers under the requested name, with no error.
 */
export async function readNamedBuild(buildName: string, buildsDir?: string): Promise<string> {
  if (!buildsDir) {
    throw new Error(`Cannot resolve build "${buildName}": no builds directory configured.`);
  }

  const buildPath = resolveBuildFile(buildName, buildsDir);
  try {
    return await fs.readFile(buildPath, "utf-8");
  } catch {
    throw new Error(
      `Build "${buildName}" not found in ${buildsDir}. ` +
      `Use list_builds for available names, or omit build_name to use the build already loaded in the Lua bridge.`
    );
  }
}

export class BuildMismatchError extends Error {}

/** Require the requested saved build to be the current bridge build without
 * replacing potentially unsaved edits. Loading another build is explicit. */
export async function loadBuildIfDifferent(
  luaClient: { getBuildInfo(): Promise<{ name?: string } | undefined>; getLoadedFilePath?(): string | undefined; loadBuildXml(xml: string, name: string, path: string): Promise<unknown> },
  buildName: string,
  buildsDir: string
): Promise<void> {
  const source = luaClient.getLoadedFilePath?.();
  const target = resolveBuildFile(buildName, buildsDir);
  if (source && source === target) return;
  if (!source) {
    const strip = (n: string) => n.replace(/\.xml$/i, '');
    try {
      const info = await luaClient.getBuildInfo();
      if (info?.name && strip(info.name) === strip(buildName)) return;
    } catch { /* The bridge state is unknown; do not replace it. */ }
  }
  await readNamedBuild(buildName, buildsDir);
  throw new BuildMismatchError(`Cannot analyze "${buildName}" without replacing the current build, which may have unsaved edits. Save it first, then use lua_load_build to load the requested build.`);
}
