import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  getToolSchemas, getLuaToolSchemas, getOptimizationToolSchemas,
  getConfigToolSchemas, getValidationToolSchemas, getExportToolSchemas,
  getSkillGemToolSchemas, getTradeToolSchemas, getPoeNinjaToolSchemas,
  getBuildGoalsToolSchemas,
} from '../../src/server/toolSchemas.js';

test('all legacy tools remain advertised when their features are enabled', () => {
  const previous: string[] = JSON.parse(readFileSync(resolve('tests/fixtures/legacy-tool-names.json'), 'utf8'));
  const groups = [getToolSchemas(), getLuaToolSchemas(), getOptimizationToolSchemas(),
    getConfigToolSchemas(), getValidationToolSchemas(), getExportToolSchemas(),
    getSkillGemToolSchemas(), getTradeToolSchemas(), getPoeNinjaToolSchemas(),
    getBuildGoalsToolSchemas()];
  const names = groups.flat().map(tool => tool.name);
  expect(previous.filter(name => !names.includes(name))).toEqual([]);
  expect(new Set(names).size).toBe(names.length);
});
