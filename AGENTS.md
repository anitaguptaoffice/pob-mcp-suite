# Repository guidance

This project serves the Simplified Chinese Path of Exile community.

- Keep one unified architecture and one implementation per capability. Do not add compatibility modes, duplicate routers or parallel service surfaces. Describe only the current design in project documentation. Keep temporary migration/comparison notes outside the repository, and verify required behavior in current-module acceptance tests before considering a capability complete.

- Use Simplified Chinese for natural-language communication and final reports to the user. Keep MCP tool output, internal diagnostics, test assertions, and machine-facing interfaces in English or structured fields by default; translate and explain their results when presenting them to Chinese-speaking users. Preserve existing protocol identifiers and serialized formats.
- Keep agent-facing skills, their operational references, and detailed machine-facing MCP documentation in English when that best preserves operational precision. Provide a Simplified Chinese entry point for users; do not mechanically translate tool schemas or protocol identifiers.
- In user-facing Chinese explanations, use established Simplified Chinese game terminology for skills, support gems, ascendancies, passive skills, items, modifiers, and other game concepts. Explain specialized terms when useful to new players. When a precise identifier is useful, include the original name or ID alongside the Chinese name. Internal game identifiers and tool data retain their original language.
- When uncertain about a game term or translation, check the corresponding game and version in the Chinese Path of Exile Wiki at https://poedb.tw/cn/; verify the English counterpart and context where needed. Do not invent a translation. If the name cannot be verified, say so and retain the original name.
- Game data changes by version and may differ between Path of Exile 1 and 2. Verify the applicable game and version before presenting version-dependent names or mechanics as facts.
- Preserve compatibility of existing machine-facing tool names, fields, identifiers, and serialized formats when improving Chinese presentation.
