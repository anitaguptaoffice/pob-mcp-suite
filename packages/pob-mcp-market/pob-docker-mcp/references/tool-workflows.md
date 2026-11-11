# PoB MCP Tool Workflows

Use `snapshot-workflows.md` for import, inspection, isolated changes and export;
use `tree-optimization.md` or `trade-tools.md` for those specialized workflows.
Inspect advertised schemas and report unavailable capabilities. Build operations
use explicit immutable snapshot IDs; do not assume an implicitly loaded build.

## Evidence and comparisons

- Prefer PoB calculations for DPS, defenses, the selected skill and item set,
  and configuration-sensitive results. XML or source-page metadata can help
  identify discrepancies; explain discrepancies rather than merging them.
- For pobb.in or official-tree sources, compare class, ascendancy, character
  level, tree version and allocated nodes with PoB before drawing conclusions.
- `_alternate` trees can use different ascendancy mappings and point rules.
  Do not infer legality from static point counts or standard-tree ID mappings.
- Compare snapshots using the same skill and configuration where a controlled
  comparison is intended. Preserve unknown values, partial results and engine
  identity warnings; do not add overlapping player, minion and full damage.
- For an equipment or gem change, inspect the original snapshot, derive or
  preview an explicit candidate, and compare both gains and lost stats. PoB
  acceptance alone does not establish game legality, price, or availability.

## Failure triage

Check the advertised tools, `inspect_pob_engine`, image identity and configured
build directory. Verify the selected snapshot and its saved skill, item set,
tree version and configuration. An unavailable source or engine is an error or
unknown result, not an empty build or zero-valued statistic.

## Plugin validation

From `packages/pob-mcp-market`, run:

```bash
python3 scripts/validate_market.py
bash -n pob-docker-mcp/scripts/pob-mcp-docker.sh
bash -n pob-docker-mcp/scripts/smoke-test.sh
```

Run `pob-docker-mcp/scripts/smoke-test.sh` when Docker and the relevant image
are available. A packaging check does not establish actual client behavior.
To verify both wrapper modes with a locally built image, run
`POB_DOCKER_IMAGE=pob-mcp-suite:foundation-local node scripts/smoke-docker-wrapper.mjs`.
On Linux, set `POB_DOCKER_USER="$(id -u):$(id -g)"` for an additional
host-ownership check; the test uses a temporary build directory.
