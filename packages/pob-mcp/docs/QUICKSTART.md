# Quick start

This guide takes a build from disk to a calculated comparison in four calls.

## 1. Build and register

```bash
npm --prefix packages/pob-mcp ci
npm --prefix packages/pob-mcp run build
```

Point your MCP client at `packages/pob-mcp/build/index.js` and set at least
`POB_DIRECTORY` (your PoB `Builds` folder) and `POB_CMD` (a compatible LuaJIT).
See [the README](../README.md#configuration) for every variable.

## 2. Import a build

```json
{ "name": "foundation_import_file", "arguments": { "build_name": "league/my-build.xml" } }
```

The response contains a `snapshot.id`. That ID is the handle for every
following call; the file on disk is not modified.

Use `foundation_import_build` for raw XML, `foundation_import_code` for a PoB
share code, or `foundation_create_build` for a new character.

## 3. Read what the engine sees

```json
{ "name": "summarize_snapshot_build", "arguments": {
  "snapshot_id": "<id>",
  "fields": ["Life", "TotalDPS", "CombinedDPS"]
} }
```

For narrower reads use `foundation_inspect` with one or more of
`build`, `tree`, `items`, `skills`, `config`, or `foundation_evaluate` with an
explicit metric list.

## 4. Change and compare

Create a child snapshot with a concrete mutation, then evaluate it:

```json
{ "name": "foundation_derive_tree", "arguments": {
  "snapshot_id": "<id>",
  "add_nodes": [12345],
  "trial": true
} }
```

```json
{ "name": "foundation_evaluate", "arguments": {
  "snapshot_id": "<child-id>",
  "fields": ["Life", "TotalDPS"]
} }
```

`trial: true` creates a seven-day snapshot. Omit it for a durable child, or
call `foundation_retain_snapshot` on a result you want to keep.

## Common flows

| Goal | Tools |
|---|---|
| What is missing or broken | `check_snapshot_issues`, `inspect_snapshot_defenses` |
| Compare two trees or items | `compare_snapshot_trees`, `foundation_preview_item` |
| Find reachable upgrades | `find_snapshot_nearby_nodes`, `find_snapshot_passive_suggestions` |
| Rank nodes with real calculations | `submit_snapshot_passive_ranking` → `summarize_snapshot_passive_ranking` |
| Rank support gems | `rank_snapshot_supports`, `rank_discovered_snapshot_supports` |
| Compare whole gem setups | `submit_snapshot_gem_setups` → `summarize_snapshot_gem_setups` |
| Cluster jewels | `inspect_snapshot_cluster_jewels`, `search_cluster_listings` |
| Watcher's Eye options | `inspect_snapshot_watchers_eye` |
| Save or share | `foundation_export_build`, `foundation_save_file`, `save_snapshot_history` |
| Reference prices | `estimate_snapshot_cost`, `reference_currency_rates` |
| Live trade | `search_official_trade`, `estimate_trade_comparable`, `preview_trade_listings` |

## Troubleshooting

| Symptom | Check |
|---|---|
| `POB_CMD` not found | Put a compatible LuaJIT on `PATH` or set an absolute `POB_CMD` |
| Syntax error loading PoB | The interpreter cannot parse the engine revision; see [POB_BRIDGE](POB_BRIDGE.md) |
| `module 'lua-utf8' not found` | Install `luautf8` for the same LuaJIT (see README) |
| Snapshot not found | Trial snapshots expire after seven days; check `foundation_snapshot_retention` |
| Trade tools absent | Set `POE_TRADE_ENABLED=true` and restart the server |
| Trade request rejected | Confirm the exact league name and `POESESSID` if the endpoint requires login |

## Next

- [Tool reference](../README.md#tool-reference)
- [Quick reference](QUICK_REFERENCE.md)
- [Tree analysis](TREE_ANALYSIS_GUIDE.md)
- [Trade](TRADE_API_QUICKSTART.md)
