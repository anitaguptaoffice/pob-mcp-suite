# Build-cost feature

`ninjaPrices.ts` is the public economy data adapter and cache; `estimate.ts` owns conservative matching and report assembly; `tool.ts` connects the feature to the existing MCP/Lua interfaces. The core estimator accepts a `PriceSource`, so it can be tested without networking and extended without embedding trade or crafting logic in the PoB adapter.

Matching principles were informed by [poe-ninja-build-cost](https://github.com/yaredmax/poe-ninja-build-cost/tree/06ef03e92855d61e5917f730887f4dcf5e40a9e2), an MIT-licensed project. No source files are copied. Only the [documented poe.ninja economy endpoints](https://poe.ninja/docs/api) are used. A client-side cache limits requests; the source recommends a shared backend for applications serving many users.

Unknown and ambiguous prices are omitted from the reference subtotal. The report never claims completeness: it does not yet value rare equipment, all jewel slots, tattoos, crafting materials, or other elements absent from the supplied build data. A comparable trade search and a crafting simulator are separate concerns and must not silently become part of the economy adapter.
