import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  getToolSchemas, getLuaToolSchemas, getOptimizationToolSchemas,
  getConfigToolSchemas, getValidationToolSchemas, getExportToolSchemas,
  getSkillGemToolSchemas, getTradeToolSchemas, getPoeNinjaToolSchemas,
  getBuildGoalsToolSchemas,
} from '../../src/server/toolSchemas.js';
import { buildCostSchemas } from '../../src/features/buildCost/tool.js';
import { comparableToolSchemas } from '../../src/features/tradeComparable/tool.js';
import { featureRegistry } from '../../src/server/featureModules.js';
import { currencyReferenceSchemas } from '../../src/features/currencyReference/tools.js';
import { currencySpreadSchema } from '../../src/features/currencySpread/tool.js';
import { buildWatchSchemas } from '../../src/features/localBuildWatch/tools.js';

// Historical legacy surface captured before the first route removal. Never
// regenerate it from the current build: silent removals must fail here.
const baseline: string[] = JSON.parse(readFileSync(resolve('tests/fixtures/migration-legacy-tool-names.json'), 'utf8'));
const retired: Record<string, { replacement: string }> = JSON.parse(readFileSync(resolve('tests/fixtures/migration-retired-legacy-tools.json'), 'utf8'));

const active = baseline.filter(name => !retired[name]);
const retiredNames = Object.keys(retired);
const advertised = () => [getToolSchemas(), getLuaToolSchemas(), getOptimizationToolSchemas(),
  getConfigToolSchemas(), getValidationToolSchemas(), getExportToolSchemas(),
  getSkillGemToolSchemas(), getTradeToolSchemas(), getPoeNinjaToolSchemas(),
  getBuildGoalsToolSchemas(), buildCostSchemas(), comparableToolSchemas(), featureRegistry.schemas()]
  .flat().map(tool => tool.name);

test('legacy surface keeps the historical baseline except documented retirements', () => {
  const names = advertised();
  expect(new Set(baseline).size).toBe(baseline.length);
  expect(retiredNames.filter(name => !baseline.includes(name))).toEqual([]);
  expect(baseline.filter(name => !active.includes(name) && !retired[name])).toEqual([]);
  expect(active.filter(name => !names.includes(name))).toEqual([]);
  expect(retiredNames.filter(name => names.includes(name))).toEqual([]);
  expect(new Set(names).size).toBe(names.length);
});

test('retired legacy tools point at advertised replacement interfaces', () => {
  const names = [...advertised(), ...currencyReferenceSchemas().map(schema => schema.name), currencySpreadSchema().name, ...buildWatchSchemas().map(schema => schema.name)];
  const replacements = [...new Set(Object.values(retired).map(entry => entry.replacement))];
  expect(replacements.filter(name => !names.includes(name))).toEqual([]);
});
