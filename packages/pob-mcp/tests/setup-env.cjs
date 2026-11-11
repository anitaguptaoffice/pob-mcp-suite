// A repository checkout pins a PoB source tree, and the server requires one.
// Publish the package root before any module resolves paths so unit tests that
// read real engine data (affix tables, modifier data) use the vendored engine
// instead of silently skipping. A standalone package has no vendor tree, and
// those tests remain skipped.
process.env.POB_REPO_ROOT ??= require('node:path').resolve(__dirname, '..');
