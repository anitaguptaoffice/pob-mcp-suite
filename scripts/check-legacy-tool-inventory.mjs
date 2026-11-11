import { access, readFile } from 'node:fs/promises';
import * as schemaGroups from '../packages/pob-mcp/build/server/toolSchemas.js';
import { buildCostSchemas } from '../packages/pob-mcp/build/features/buildCost/tool.js';
import { comparableToolSchemas } from '../packages/pob-mcp/build/features/tradeComparable/tool.js';
import { featureRegistry } from '../packages/pob-mcp/build/server/featureModules.js';

const readJson = async relative => JSON.parse(await readFile(new URL(relative, import.meta.url), 'utf8'));
// The baseline is the historical legacy surface captured before the first
// route removal. It must not be regenerated from the current build, otherwise
// retired tools silently disappear from the documentation check.
const baseline = await readJson('../packages/pob-mcp/tests/fixtures/migration-legacy-tool-names.json');
const retired = await readJson('../packages/pob-mcp/tests/fixtures/migration-retired-legacy-tools.json');

const tools = Object.entries(schemaGroups)
  .filter(([name, value]) => /^get.*Schemas$/.test(name) && typeof value === 'function')
  .flatMap(([, getSchemas]) => getSchemas());
tools.push(...buildCostSchemas(), ...comparableToolSchemas(), ...featureRegistry.schemas());
const current = tools.map(tool => tool.name);

const text = await readFile(new URL('../docs/LEGACY_TOOL_INVENTORY.md', import.meta.url), 'utf8');
const documented = [...text.matchAll(/^- `([^`]+)` — target:/gm)].map(match => match[1]);
const rows = new Map();
for (const line of text.split('\n')) {
  const row = /^- `([^`]+)` — target: .*?; replacement: (.*?); status: (.*?); skill references:/.exec(line);
  if (row) rows.set(row[1], { replacement: row[2], status: row[3] });
}
const contracts = await readFile(new URL('../docs/LEGACY_MIGRATION_CONTRACTS.md', import.meta.url), 'utf8');
const mapped = [...contracts.matchAll(/^\| `([^`]+)` \|/gm)].map(match => match[1]);

const duplicates = values => values.filter((value, index) => values.indexOf(value) !== index);
const retiredNames = Object.keys(retired);
const isRetired = name => Object.prototype.hasOwnProperty.call(retired, name);

const duplicateTools = duplicates(current);
const duplicateBaseline = duplicates(baseline);
const duplicateDocs = duplicates(documented);
const duplicateContracts = duplicates(mapped);

// Every advertised legacy tool must come from the captured baseline, and every
// baseline tool is either still advertised or explicitly retired with a
// replacement. A silent removal or a new legacy tool fails this check.
const unexpectedCurrent = current.filter(name => !baseline.includes(name));
const retiredStillAdvertised = retiredNames.filter(name => current.includes(name));
const missingWithoutRetirement = baseline.filter(name => !current.includes(name) && !isRetired(name));
const retiredOutsideBaseline = retiredNames.filter(name => !baseline.includes(name));
const invalidRetirements = retiredNames.filter(name => {
  const entry = retired[name];
  return typeof entry?.replacement !== 'string' || !entry.replacement.trim() || !Array.isArray(entry.evidence) || !entry.evidence.length;
});
const undocumentedRetirement = retiredNames.filter(name => {
  const row = rows.get(name);
  return !row || !row.replacement.includes(`\`${retired[name].replacement}\``) || !/^retired\b/.test(row.status.trim());
});

const missing = baseline.filter(name => !documented.includes(name));
const extra = documented.filter(name => !baseline.includes(name));
const missingContracts = baseline.filter(name => !mapped.includes(name));
const extraContracts = mapped.filter(name => !baseline.includes(name));

const missingEvidence = [];
for (const entry of Object.values(retired)) {
  for (const relative of entry.evidence ?? []) {
    try { await access(new URL(`../packages/pob-mcp/tests/${relative}`, import.meta.url)); }
    catch { missingEvidence.push(relative); }
  }
}

const problems = { missing, extra, duplicateTools, duplicateBaseline, duplicateDocs, missingContracts, extraContracts, duplicateContracts,
  unexpectedCurrent, retiredStillAdvertised, missingWithoutRetirement, retiredOutsideBaseline, invalidRetirements, undocumentedRetirement, missingEvidence };
const failed = Object.values(problems).some(values => values.length);
if (failed) {
  console.error(JSON.stringify(problems, null, 2));
  process.exitCode = 1;
} else {
  console.log(`Legacy inventory covers ${baseline.length} baseline tools: ${current.length} still advertised, ${retiredNames.length} retired with replacements`);
}
