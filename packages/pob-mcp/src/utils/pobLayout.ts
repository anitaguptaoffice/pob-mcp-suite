import fs from "fs";
import os from "os";
import path from "path";

/** Where the Lua engine lives and how to reach its modules. */
interface PoBLayout {
  kind: "checkout" | "macos-app";
  /** Directory holding HeadlessWrapper.lua; the cwd for the Lua process. */
  src: string;
  luaPath: string[];
  luaCPath: string[];
}

const exists = (p: string): boolean => {
  try {
    fs.accessSync(p);
    return true;
  } catch {
    return false;
  }
};

function appBundleCandidates(): string[] {
  const home = os.homedir();
  return [
    "/Applications/Path of Building.app",
    "/Applications/PathOfBuilding.app",
    path.join(home, "Applications", "Path of Building.app"),
    path.join(home, "Applications", "PathOfBuilding.app"),
  ];
}

/** A bundle only counts if it carries the pure-Lua modules. */
function findAppBundle(): string | null {
  return appBundleCandidates().find((b) => exists(path.join(b, "Contents", "Resources", "lua"))) ?? null;
}

/** The launcher's updater keeps the Application Support copy current, so prefer it. */
function macAppSrcCandidates(bundle: string): string[] {
  return [
    path.join(os.homedir(), "Library", "Application Support", "PathOfBuildingMac", "src"),
    path.join(bundle, "Contents", "Resources", "src"),
  ];
}

const stripSrc = (p: string): string => {
  const trimmed = p.replace(/[\\/]+$/, "");
  return /[\\/]src$/.test(trimmed) ? trimmed.slice(0, -4) : trimmed;
};

function checkoutLayout(src: string): PoBLayout {
  const base = stripSrc(src);
  const runtime = path.join(base, "runtime");
  const runtimeLua = path.join(runtime, "lua");
  const luaRocks = path.join(os.homedir(), ".luarocks", "lib", "lua", "5.1");
  const ext = process.platform === "win32" ? "dll" : "so";

  return {
    kind: "checkout",
    src,
    luaPath: [path.join(runtimeLua, "?.lua"), path.join(runtimeLua, "?", "init.lua")],
    // runtime/ first so a checkout's own modules win over luarocks
    luaCPath: [path.join(runtime, `?.${ext}`), path.join(luaRocks, `?.${ext}`)],
  };
}

function macAppLayout(bundle: string, src: string): PoBLayout {
  const lua = path.join(bundle, "Contents", "Resources", "lua");
  const macos = path.join(bundle, "Contents", "MacOS");

  return {
    kind: "macos-app",
    src,
    // sha1 is a directory module, hence the ?/init.lua entry
    luaPath: [path.join(lua, "?.lua"), path.join(lua, "?", "init.lua")],
    // the bundle ships .dylib rather than .so
    luaCPath: [path.join(macos, "?.dylib")],
  };
}

/** The PoB source tree pinned inside this repository, when it is available. */
function vendoredCheckout(): string | null {
  const packageRoot = process.env.POB_REPO_ROOT;
  if (!packageRoot) return null;
  const src = path.resolve(packageRoot, '..', '..', 'vendor', 'PathOfBuilding', 'src');
  return exists(path.join(src, 'HeadlessWrapper.lua')) ? src : null;
}

const missingEngine = (detail: string): Error => new Error(
  `Path of Building engine not found: ${detail}\n`
  + 'This server requires a PoB src/ checkout with HeadlessWrapper.lua and a LuaJIT interpreter. '
  + 'Set POB_PATH to that checkout, or run from a full repository checkout that includes vendor/PathOfBuilding.',
);

const hasEngine = (src: string): boolean => exists(path.join(src, "HeadlessWrapper.lua"));

/**
 * An explicit src wins, treated as a checkout unless it has no sibling runtime/ and an
 * app is installed. Otherwise prefer an installed app: no setup, and always the same
 * PoB the user runs. Resolution fails when no usable engine checkout exists.
 */
export function resolvePoBLayout(explicitSrc?: string): PoBLayout {
  const bundle = process.platform === "darwin" ? findAppBundle() : null;

  if (explicitSrc) {
    const src = explicitSrc.replace(/[\\/]+$/, "");
    if (!hasEngine(src)) throw missingEngine(`POB_PATH points at ${src}, which has no HeadlessWrapper.lua`);
    return !exists(path.join(stripSrc(src), "runtime")) && bundle
      ? macAppLayout(bundle, src)
      : checkoutLayout(src);
  }

  if (bundle) {
    const src = macAppSrcCandidates(bundle).find(hasEngine);
    if (src) return macAppLayout(bundle, src);
  }

  const installed = path.join(os.homedir(), "Projects", "PathOfBuilding", "src");
  if (hasEngine(installed)) return checkoutLayout(installed);
  const vendored = vendoredCheckout();
  if (vendored) return checkoutLayout(vendored);
  throw missingEngine('no installed app, ~/Projects/PathOfBuilding checkout or vendored engine was found');
}

/** Where the installed PoB actually writes builds. */
export function defaultBuildsDirectory(): string {
  const home = os.homedir();
  if (process.platform !== "darwin") {
    return path.join(home, "Documents", "Path of Building", "Builds");
  }
  // current port uses Application Support; the older Qt port used ~/Path of Building
  const appSupport = path.join(home, "Library", "Application Support", "Path of Building", "Builds");
  const qtPortBuilds = path.join(home, "Path of Building", "Builds");
  if (exists(appSupport)) return appSupport;
  return exists(qtPortBuilds) ? qtPortBuilds : appSupport;
}
