import { describe, expect, it } from '@jest/globals';
import { FeatureRegistry, type FeatureTool } from '../../src/server/featureRegistry.js';
import { featureRegistry } from '../../src/server/featureModules.js';

describe('feature tool registry', () => {
  it('registers stateless tools and resolves each advertised name', () => {
    expect(featureRegistry.schemas().map(schema => schema.name)).toEqual(['compare_craft_budget', 'simulate_simple_annul']);
    for (const schema of featureRegistry.schemas()) expect(featureRegistry.get(schema.name)?.schema).toBe(schema);
    expect(featureRegistry.get('not_a_tool')).toBeUndefined();
  });

  it('rejects duplicate registrations', () => {
    const tool: FeatureTool = { schema: { name: 'example', description: 'test', inputSchema: { type: 'object' } }, invoke: () => ({ content: [] }) };
    expect(() => new FeatureRegistry([tool, tool])).toThrow('duplicate');
  });

  it('invokes the handler registered with the advertised schema', async () => {
    const result = await featureRegistry.get('compare_craft_budget')!.invoke({ scenarios: [
      { name: 'test', success_probability: 0.5, chaos_per_attempt: 2, probability_source: 'fixture' },
    ] });
    expect(JSON.parse(result.content[0].text).scenarios[0].expectedChaos).toBe(4);
  });
});

describe('all advertised schema names', () => {
  it('rejects duplicates across independently supplied groups', () => {
    const { assertUniqueToolSchemas } = require('../../src/server/featureRegistry.js');
    const schema = { name: 'same', description: 'x', inputSchema: { type: 'object' } };
    expect(() => assertUniqueToolSchemas([schema, schema])).toThrow('duplicate or empty tool name');
    expect(() => assertUniqueToolSchemas([schema])).not.toThrow();
  });
});
