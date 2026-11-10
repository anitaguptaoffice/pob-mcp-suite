import { describe, expect, it, jest } from '@jest/globals';
import { handleSearchClusterJewels } from '../../src/handlers/clusterJewelHandlers';

function listing(name: string, notable: string) {
  return { id: name, item: { name, typeLine: 'Large Cluster Jewel', ilvl: 84, enchantMods: ['Adds 8 Passive Skills', 'Added Small Passive Skills grant: 10% increased Fire Damage'], explicitMods: [`1 Added Passive Skill is ${notable}`] }, listing: { price: { amount: 10, currency: 'chaos' } } };
}

describe('cluster jewel trade search', () => {
  it('accepts the published size, uses the official passive-count ID, and matches exact current notable text', async () => {
    const searchItems = jest.fn<(league: string, query: any) => Promise<any>>(async () => ({ id: 'q', total: 100, result: ['1', '2'], inexact: true }));
    const result = await handleSearchClusterJewels({ tradeClient: { searchItems, fetchItems: async () => [listing('wanted', 'Prismatic Heart'), listing('other', 'Prismatic Heartbeat')] } as any }, { league: 'League', jewel_size: 'large', passive_count: 8, notables: ['Prismatic Heart'], limit: 5 });
    const query = searchItems.mock.calls[0][1];
    expect(query.query.status.option).toBe('securable');
    expect(query.query.type).toBe('Large Cluster Jewel');
    expect(query.query.stats[0].filters[0]).toEqual({ id: 'enchant.stat_3086156145', value: { min: 8, max: 8 } });
    expect(query.query.stats[0].type).toBe('count');
    expect(query.query.stats[0].value.min).toBe(1);
    expect(query.query.stats[0].filters[1].id).toBe('explicit.stat_3086156145');
    expect(result.content[0].text).toContain('wanted');
    expect(result.content[0].text).not.toContain('other');
    expect(result.content[0].text).toContain('仅检查 2 条样本');
    expect(result.content[0].text).toContain('近似匹配');
  });

  it('reports a sample-limited miss and keeps legacy online_only', async () => {
    const searchItems = jest.fn<(league: string, query: any) => Promise<any>>(async () => ({ id: 'q', total: 200, result: ['1'] }));
    const result = await handleSearchClusterJewels({ tradeClient: { searchItems, fetchItems: async () => [listing('first', 'Other')] } as any }, { league: 'League', size: 'Large', notables: ['Missing'], online_only: true });
    expect(searchItems.mock.calls[0][1].query.status.option).toBe('available');
    expect(result.content[0].text).toContain('只检查了 1 条样本');
  });

  it('rejects invalid arguments before sending a search', async () => {
    const searchItems = jest.fn();
    await expect(handleSearchClusterJewels({ tradeClient: { searchItems } as any }, { league: 'League', jewel_size: 'bad' as any })).rejects.toThrow('invalid');
    expect(searchItems).not.toHaveBeenCalled();
  });
});
