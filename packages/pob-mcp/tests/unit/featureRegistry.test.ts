import { describe, expect, it } from '@jest/globals';
import { FeatureRegistry, type FeatureTool } from '../../src/server/featureRegistry.js';
import { featureRegistry } from '../../src/server/featureModules.js';
import { getToolSchemas, getLuaToolSchemas, getOptimizationToolSchemas, getConfigToolSchemas, getValidationToolSchemas, getExportToolSchemas, getSkillGemToolSchemas, getTradeToolSchemas, getPoeNinjaToolSchemas, getBuildGoalsToolSchemas } from '../../src/server/toolSchemas.js';
import { buildCostSchemas } from '../../src/features/buildCost/tool.js';
import { comparableToolSchemas } from '../../src/features/tradeComparable/tool.js';

describe('feature tool registry', () => {
  it('registers migrated tools without colliding with any legacy capability group', () => {
    featureRegistry.assertNoCollisions([...getToolSchemas(), ...getLuaToolSchemas(), ...getOptimizationToolSchemas(),
      ...getConfigToolSchemas(), ...getValidationToolSchemas(), ...getExportToolSchemas(), ...getSkillGemToolSchemas(),
      ...getTradeToolSchemas(), ...getPoeNinjaToolSchemas(), ...getBuildGoalsToolSchemas(), ...buildCostSchemas(), ...comparableToolSchemas()]);
    expect(featureRegistry.schemas().map(schema => schema.name)).toEqual(['compare_craft_budget', 'simulate_simple_annul']);
    for (const schema of featureRegistry.schemas()) expect(featureRegistry.get(schema.name)?.schema).toBe(schema);
    expect(featureRegistry.get('not_a_tool')).toBeUndefined();
  });

  it('rejects duplicate registrations and legacy name collisions', () => {
    const tool: FeatureTool = { schema: { name: 'example', description: 'test', inputSchema: { type: 'object' } }, invoke: () => ({ content: [] }) };
    expect(() => new FeatureRegistry([tool, tool])).toThrow('duplicate');
    expect(() => new FeatureRegistry([tool]).assertNoCollisions([tool.schema])).toThrow('collides');
  });

  it('invokes the handler registered with the advertised schema', async () => {
    const result = await featureRegistry.get('compare_craft_budget')!.invoke({ scenarios: [
      { name: 'test', success_probability: 0.5, chaos_per_attempt: 2, probability_source: 'fixture' },
    ] });
    expect(JSON.parse(result.content[0].text).scenarios[0].expectedChaos).toBe(4);
  });
});
