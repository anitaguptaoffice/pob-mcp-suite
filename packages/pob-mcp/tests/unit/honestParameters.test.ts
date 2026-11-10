import { describe, it, expect, jest } from '@jest/globals';
import { handleFindItemUpgrades } from '../../src/handlers/itemShoppingHandler.js';
import { handleOptimizeTree } from '../../src/handlers/optimizationHandlers.js';
import type { PoBLuaApiClient } from '../../src/pobLuaBridge.js';
import type { StatsExport } from '../../src/pobLuaBridge.js';

type ShoppingContext = Parameters<typeof handleFindItemUpgrades>[0];
type OptContext = Parameters<typeof handleOptimizeTree>[0];
/** Partial bridge stand-in; handlers only touch the methods each fixture stubs. */
const stubClient = (impl: Partial<PoBLuaApiClient>) => impl as PoBLuaApiClient;

// Two honesty regressions: placeholders must not masquerade as analysis,
// and declared constraints must actually shape (or be honestly reported on)
// the result.

describe('handleFindItemUpgrades without a Lua bridge', () => {
  const context: ShoppingContext = { getLuaClient: () => null };

  it('discloses that build stats are unavailable instead of inventing gaps', async () => {
    const result = await handleFindItemUpgrades(context, { slot: 'Helmet' });
    const text = result.content[0].text;

    expect(text).toContain('Life: unknown');
    // The placeholder life=0 must never render as a real life gap…
    expect(text).not.toContain('Life is 0');
    // …nor placeholder resist=75 as real "Build Status" proof.
    expect(text).not.toContain('✓');
    expect(text).toContain('candidate items have not been checked');
  });

  it('reports available live stats without assuming a resistance cap', async () => {
    const bridged: ShoppingContext = {
      getLuaClient: () => stubClient({
        getBuildInfo: async () => ({ name: 'Test', className: 'Witch', ascendClassName: 'Occultist' }),
        getStats: async (): Promise<StatsExport> => ({ Life: 3000, EnergyShield: 200, FireResist: 50, ColdResist: 75, LightningResist: 75, ChaosResist: 30 }),
        getItems: async () => [],
      }),
    };
    const result = await handleFindItemUpgrades(bridged, { slot: 'Helmet' });
    const text = result.content[0].text;

    expect(text).toContain('Fire Resistance: 50%');
    expect(text).toContain('Resistance caps and requirements depend on the build');
  });
});

describe('handleOptimizeTree constraints', () => {
  const nearby = [
    { nodeId: 111, node: { name: 'Notable A', isNotable: true, stats: [] } },
    { nodeId: 222, node: { name: 'Protected Notable', isNotable: true, stats: [] } },
    { nodeId: 333, node: { name: 'Notable B', isNotable: true, stats: [] } },
  ];

  const context = (): OptContext => ({
    buildService: {
      readBuild: async () => { throw new Error('not on disk'); },
      parseAllocatedNodes: () => [],
      extractBuildVersion: () => '3_26',
    } as unknown as OptContext['buildService'],
    treeService: {
      getTreeData: async () => ({ nodes: new Map() }),
      findNearbyNodes: () => nearby,
    } as unknown as OptContext['treeService'],
    pobDirectory: '/nonexistent',
    getLuaClient: () => stubClient({
      loadBuildXml: async () => ({ ok: true }),
      getStats: async (): Promise<StatsExport> => ({ Life: 2800, EnergyShield: 500, TotalDPS: 9000, FireResist: 75, ColdResist: 75, LightningResist: 75 }),
      getTree: async () => ({ nodes: [1, 2, 3], ascendancyPointsUsed: 0, classId: 0, ascendClassId: 0, secondaryAscendClassId: 0, masteryEffects: {}, treeVersion: '3_26' }),
    }),
    ensureLuaClient: async () => {},
  });

  it('uses live allocated nodes and the live tree version rather than saved XML', async () => {
    const c = context();
    const getTreeData = jest.fn(async (_version?: string) => ({ nodes: new Map() }));
    const findNearbyNodes = jest.fn((_nodes: Set<string>) => nearby);
    c.treeService = { getTreeData, findNearbyNodes } as unknown as OptContext['treeService'];
    c.buildService = { readBuild: async () => ({ Tree: { activeSpec: '1' } }),
      parseAllocatedNodes: () => ['999'], extractBuildVersion: () => '3_13' } as unknown as OptContext['buildService'];
    await handleOptimizeTree(c, '', 'balanced');
    expect(getTreeData).toHaveBeenCalledWith('3_26');
    expect(findNearbyNodes.mock.calls[0][0]).toEqual(new Set(['1', '2', '3']));
  });

  it('refuses to guess a tree version when the bridge does not provide one', async () => {
    const c = context();
    const client = c.getLuaClient()!;
    client.getTree = async () => ({ nodes: [1], ascendancyPointsUsed: 0, classId: 0, ascendClassId: 0, secondaryAscendClassId: 0, masteryEffects: {} });
    c.getLuaClient = () => client;
    await expect(handleOptimizeTree(c, '', 'balanced')).rejects.toThrow('tree version or allocated nodes are unavailable');
  });

  it('excludes protected nodes from recommendations', async () => {
    const result = await handleOptimizeTree(
      context(), '', 'balanced', 10, { protectedNodes: ['222'] },
    );
    const text = result.content[0].text;

    expect(text).toContain('Notable A');
    expect(text).toContain('Notable B');
    expect(text).not.toContain('Protected Notable');
    expect(text).toContain('1 matching suggestion(s) dropped');
  });

  it('reports minLife against current stats instead of echoing the constraint', async () => {
    const result = await handleOptimizeTree(
      context(), '', 'balanced', 10, { minLife: 3000 },
    );
    const text = result.content[0].text;

    expect(text).toContain('Min Life 3000');
    expect(text).toContain('NOT met by current build');
    expect(text).not.toContain('Constraints Applied');
  });

  it('says met when the current build already satisfies the minimum', async () => {
    const result = await handleOptimizeTree(
      context(), '', 'balanced', 10, { minLife: 1500 },
    );
    expect(result.content[0].text).toContain('met by current build');
  });
});
