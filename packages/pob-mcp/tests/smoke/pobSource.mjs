// Shared inputs for the smoke tests: where the Lua engine is, and a geared build.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolvePoBLayout } from '../../build/utils/pobLayout.js';

/**
 * The src/ the Lua process runs in. Resolved the same way the server resolves it,
 * so an installed PoB needs no configuration; POB_PATH still wins when set.
 */
export function smokePoBSrc() {
  const explicit = process.env.POB_PATH || process.env.POB_FORK_PATH;
  let { src, kind } = resolvePoBLayout(explicit);
  // The repository pins a PoB source tree for reproducible smoke runs; use it
  // when no installed engine is configured or detected.
  if (!explicit && !existsSync(join(src, 'HeadlessWrapper.lua'))) {
    const vendored = fileURLToPath(new URL('../../../../vendor/PathOfBuilding/src/', import.meta.url));
    if (existsSync(join(vendored, 'HeadlessWrapper.lua'))) { src = vendored; kind = 'checkout'; }
  }
  if (!existsSync(join(src, 'HeadlessWrapper.lua'))) {
    throw new Error(
      `No PoB engine at ${src} (resolved as ${kind}). Install Path of Building, ` +
        `or set POB_PATH to the src directory of a checkout.`
    );
  }
  return src;
}

/** A geared build the repo owns, so no smoke test needs a PoB checkout. */
export const gearedBuildXml = fileURLToPath(new URL('../fixtures/occ-vortex.xml', import.meta.url));
