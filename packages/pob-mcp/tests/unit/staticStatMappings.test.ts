import { StatMapper } from '../../src/adapters/staticStats/catalog.js';
import { StatMapper as LegacyMapper } from '../../src/services/statMapper.js';
import { createStaticStatMappingTool } from '../../src/features/tradeMetadata/staticMappings.js';

it('retains legacy aliases and clearly labels bundled Trade IDs as unverified', async () => {
  const source = new StatMapper(), tool = createStaticStatMappingTool(source);
  const result = JSON.parse((await tool.invoke({ query: 'minion damage', limit: 2 })).content[0].text);
  expect(result.source).toBe('bundled_stat_aliases'); expect(result.catalogDigest).toMatch(/^[a-f0-9]{64}$/);
  expect(result.results.map((item: { pobName: string }) => item.pobName)).toEqual(new LegacyMapper().fuzzySearch('minion damage', 2).map(item => item.pobName));
  expect(result.results.length).toBeGreaterThan(0); expect(result.results.every((item: { officialStatus: string }) => item.officialStatus === 'unverified')).toBe(true);
  expect(result.results).toContainEqual(expect.objectContaining({ pobName: 'MinionDamage', tradeId: 'pseudo.pseudo_minion_damage', officialStatus: 'unverified' }));
  expect(result.warnings.join(' ')).toMatch(/obsolete|invalid/);
  const snapshot = source.catalog(); snapshot[0].aliases.push('mutated');
  expect(source.catalog()[0].aliases).not.toContain('mutated');
});

it('reports actual truncation and rejects invalid inputs without calling the source', async () => {
  const source = new StatMapper(), tool = createStaticStatMappingTool(source);
  const result = JSON.parse((await tool.invoke({ query: 'life', limit: 1 })).content[0].text);
  expect(result.totalMatches).toBeGreaterThan(1); expect(result.truncated).toBe(true);
  await expect(tool.invoke({ query: '  ' })).rejects.toThrow();
  await expect(tool.invoke({ query: 'life', limit: 100 })).rejects.toThrow();
  await expect(tool.invoke({ query: 'life', extra: true })).rejects.toThrow();
});
