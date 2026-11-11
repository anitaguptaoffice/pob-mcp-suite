# PoB bridge and engine setup

The server does not reimplement Path of Building. It starts a headless PoB
process and talks to it over a line-delimited JSON stdio protocol defined by
`lua/vanilla_stdio_bridge.lua`.

## Architecture

```
MCP client
   │  JSON-RPC over stdio
   ▼
pob-mcp server  ──snapshot store──►  <POB_SNAPSHOT_DIRECTORY>
   │  spawn( POB_CMD, [adapter] )
   ▼
headless PoB process (vendor/PathOfBuilding/src or POB_PATH)
   │  build XML, PoB APIs
   ▼
one immutable snapshot per calculated state
```

- The engine source is not modified. `vanilla_stdio_bridge.lua` is loaded as a
  separate file; `#@` directive lines in PoB source are stripped at load time.
- One engine process serves one request stream. Long job items are evaluated in
  isolated engine processes so a failure cannot poison the baseline.
- The adapter exposes PoB-native actions only. Business rules, validation and
  response shaping live in `src/features`, `src/domain` and `src/foundation`.

## Engine resolution

`resolvePoBLayout()` picks the engine directory in this order:

1. `POB_PATH`
2. a detected installed Path of Building app (macOS)
3. `vendor/PathOfBuilding/src` in this repository

Resolution fails when none of them contains `HeadlessWrapper.lua`, and the
server opens one engine at startup to verify the interpreter, bridge and data.
`POB_CMD` chooses the interpreter. It defaults to `luajit` on `PATH`; set an
absolute path when the compatible interpreter is not first on `PATH`.

## Interpreter requirements

| Requirement | Why |
|---|---|
| Lua 5.1 / LuaJIT ABI | PoB modules and bundled C modules target it |
| Compound assignment support | Recent PoB revisions use `count += 1` |
| `lua-utf8` and any other PoB C modules | Missing modules abort engine start |

Check before configuring the server:

```bash
"$POB_CMD" -v
"$POB_CMD" -bl "$POB_PATH/Modules/Main.lua" > /dev/null
```

`'=' expected near '+'` means the interpreter cannot parse the revision.

Install a missing module for the same interpreter:

```bash
luarocks --lua-version=5.1 --lua-dir=/path/to/luajit-prefix --local install luautf8
```

The bridge adds the engine's `runtime/` directory and
`~/.luarocks/lib/lua/5.1` to `LUA_PATH` / `LUA_CPATH`.

## Verifying the bridge

```bash
npm --prefix packages/pob-mcp run test:smoke
```

This resolves the engine exactly as the server does and checks process
lifecycle, build loading, state truthfulness and an MCP stdio round trip.
`inspect_pob_engine` performs the same start check from a client and reports
the actual engine version and available bridge actions.

## Protocol notes

- Requests are `{ id, action, params }`; responses are `{ id, ok, error? }`
  plus action-specific fields.
- Stdout is reserved for protocol frames. Diagnostic output goes to stderr and
  is visible only with `POB_DEBUG=true`.
- A request that exceeds `POB_TIMEOUT_MS` fails that request; the next request
  reuses the process only if it is still alive.
- Serialization avoids crashing on values PoB cannot encode; unsupported
  fields are reported as missing rather than fabricated.

## Troubleshooting

| Symptom | Cause | Action |
|---|---|---|
| `Failed to spawn LuaJIT process` | `POB_CMD` not found or not executable | Use an absolute path |
| Engine exits immediately | Syntax or missing module | Run the two compile checks above and read stderr with `POB_DEBUG=true` |
| Request times out | Engine idle, huge build or a slow ranking item | Raise `POB_TIMEOUT_MS`; split the work |
| Results differ from desktop PoB | Different engine revision or PoB settings | Compare `identity` fields, tree version and config |
| `module 'lua-utf8' not found` | Module installed for another interpreter | Reinstall for the same `POB_CMD` |
