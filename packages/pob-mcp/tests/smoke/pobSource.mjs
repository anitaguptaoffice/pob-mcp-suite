// Shared inputs for the smoke tests: where the Lua engine is, and a geared build.
import { fileURLToPath } from 'node:url';
import { resolvePoBLayout } from '../../build/utils/pobLayout.js';

// Smoke runs resolve the vendored engine relative to the package root.
process.env.POB_REPO_ROOT ??= fileURLToPath(new URL('../../', import.meta.url));

/**
 * The src/ the Lua process runs in, resolved the same way the server resolves it.
 * POB_PATH wins when set; otherwise an installed PoB or the vendored checkout is used.
 */
export function smokePoBSrc() {
  return resolvePoBLayout(process.env.POB_PATH).src;
}

/** A geared build the repo owns, so no smoke test needs a PoB checkout. */
export const gearedBuildXml = fileURLToPath(new URL('../fixtures/occ-vortex.xml', import.meta.url));
