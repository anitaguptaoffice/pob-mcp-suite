import { readFile } from 'node:fs/promises';
import * as schemaGroups from '../packages/pob-mcp/build/server/toolSchemas.js';
import { buildCostSchemas } from '../packages/pob-mcp/build/features/buildCost/tool.js';
import { comparableToolSchemas } from '../packages/pob-mcp/build/features/tradeComparable/tool.js';
import { featureRegistry } from '../packages/pob-mcp/build/server/featureModules.js';

const tools = Object.entries(schemaGroups)
  .filter(([name, value]) => /^get.*Schemas$/.test(name) && typeof value === 'function')
  .flatMap(([, getSchemas]) => getSchemas());
tools.push(...buildCostSchemas(), ...comparableToolSchemas(), ...featureRegistry.schemas());
const expected = tools.map(tool => tool.name);
const text = await readFile(new URL('../docs/LEGACY_TOOL_INVENTORY.md', import.meta.url), 'utf8');
const documented = [...text.matchAll(/^- `([^`]+)` — target:/gm)].map(match => match[1]);
const contracts = await readFile(new URL('../docs/LEGACY_MIGRATION_CONTRACTS.md', import.meta.url), 'utf8');
const mapped = [...contracts.matchAll(/^\| `([^`]+)` \|/gm)].map(match => match[1]);
const duplicates = values => values.filter((value, index) => values.indexOf(value) !== index);
const missing = expected.filter(name => !documented.includes(name));
const extra = documented.filter(name => !expected.includes(name));
const duplicateTools = duplicates(expected);
const duplicateDocs = duplicates(documented);
const missingContracts = expected.filter(name => !mapped.includes(name));
const extraContracts = mapped.filter(name => !expected.includes(name));
const duplicateContracts = duplicates(mapped);
if (missing.length || extra.length || duplicateTools.length || duplicateDocs.length || missingContracts.length || extraContracts.length || duplicateContracts.length) {
  console.error(JSON.stringify({ missing, extra, duplicateTools, duplicateDocs, missingContracts, extraContracts, duplicateContracts }, null, 2));
  process.exitCode = 1;
} else {
  console.log(`Legacy inventory and migration contracts cover ${expected.length} tools`);
}
