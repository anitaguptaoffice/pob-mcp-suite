import { describe, expect, it } from '@jest/globals';
import { handleExportBuildSummary } from '../../src/handlers/exportHandlers.js';

function context(overrides: Record<string, unknown> = {}) {
  return {
    treeService: { getTreeData: async () => ({}), mapNodesToDetails: async () => ({ nodes: [], invalidIds: ['999'] }) },
    luaClient: {
      getBuildInfo: async () => ({ name: 'Summoner', level: 90, className: 'Witch', ascendClassName: 'Necromancer' }),
      getStats: async () => ({ Life: 0, MinionTotalDPS: 12345, FireResist: 75 }),
      getTree: async () => ({ classId: 2, className: 'Witch', ascendClassId: 1, secondaryAscendClassId: 0, treeVersion: '3_29', nodes: [999], masteryEffects: { 10: 20 } }),
      getSkills: async () => ({ mainSocketGroup: 1, groups: [{ index: 1, slot: 'Body Armour', gems: [{ name: 'Raise Zombie', level: 20, quality: 0, enabled: true, isSupport: false }] }] }),
      getItems: async () => [{ slot: 'Helmet', id: 10, name: 'Example', raw: 'Rarity: RARE\nExample\nHelmet' }, { slot: 'Ring 1', id: 0 }],
      getConfig: async () => ({ enemyIsBoss: 'Shaper', useFrenzyCharges: false }),
      ...overrides,
    },
  } as unknown as Parameters<typeof handleExportBuildSummary>[0];
}

const report = async (ctx: Parameters<typeof handleExportBuildSummary>[0]) =>
  (await handleExportBuildSummary(ctx)).content[0].text;

describe('Chinese build report', () => {
  it('includes live information and preserves original item and configuration data', async () => {
    const text = await report(context());
    expect(text).toContain('职业：Witch');
    expect(text).toContain('天赋树版本：3_29');
    expect(text).toContain('| 生命 | 0 |');
    expect(text).toContain('| 能量护盾 | 未提供 |');
    expect(text).toContain('| MinionTotalDPS | 12,345 |');
    expect(text).toContain('主技能组');
    expect(text).toContain('Raise Zombie');
    expect(text).toContain('    Rarity: RARE');
    expect(text).not.toContain('### Ring 1');
    expect(text).toContain('10 → 20');
    expect(text).toContain('无法解析 1 个节点');
    expect(text).toContain('| enemyIsBoss | Shaper |');
    expect(text).toContain('| useFrenzyCharges | false |');
  });

  it('reports unavailable sections instead of inventing zeroes or empty equipment', async () => {
    const fail = async () => { throw new Error('bridge unavailable'); };
    const text = await report(context({ getStats: fail, getItems: fail, getConfig: fail }));
    expect(text).toContain('| 生命 | 未提供 |');
    expect(text).toContain('未取得装备数据');
    expect(text).toContain('未取得计算配置');
    expect(text).toContain('## 未取得的数据');
    expect(text).toContain('- 计算属性');
    expect(text).not.toContain('没有已装备的物品');
  });
});
