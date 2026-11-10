import { describe, it, expect, beforeEach } from '@jest/globals';

// loadEndgame reads the build file off disk before handing it to the bridge.
jest.mock('fs/promises', () => ({
  __esModule: true,
  default: { readFile: jest.fn(async () => '<?xml version="1.0"?><PathOfBuilding/>') },
}));

import {
  handleListBuilds,
  handleAnalyzeBuild,
  handleCompareBuilds,
  handleGetBuildStats,
  type HandlerContext,
} from '../../src/handlers/buildHandlers.js';
import { BuildService } from '../../src/services/buildService.js';
import { TreeService } from '../../src/services/treeService.js';
import type { PoBBuild } from '../../src/types.js';

describe('BuildHandlers', () => {
  let context: HandlerContext;
  let mockBuildService: jest.Mocked<BuildService>;
  let mockTreeService: jest.Mocked<TreeService>;

  beforeEach(() => {
    // Create mock services
    mockBuildService = {
      listBuilds: jest.fn(),
      readBuild: jest.fn(),
      generateBuildSummary: jest.fn(),
    } as unknown as jest.Mocked<BuildService>;

    mockTreeService = {
      analyzePassiveTree: jest.fn(),
    } as unknown as jest.Mocked<TreeService>;

    context = {
      buildService: mockBuildService,
      treeService: mockTreeService,
      validationService: {
        validateBuild: jest.fn(),
        formatValidation: jest.fn(),
      } as any,
      pobDirectory: '/tmp/builds',
      getLuaClient: jest.fn(() => null),
      ensureLuaClient: jest.fn(async () => undefined),
    };
  });

  describe('handleListBuilds', () => {
    it('should return formatted list of builds', async () => {
      mockBuildService.listBuilds.mockResolvedValue([
        'build1.xml',
        'build2.xml',
        'league/starter.xml',
      ]);

      const result = await handleListBuilds(context);

      expect(result.content).toHaveLength(1);
      expect(result.content[0].type).toBe('text');
      expect(result.content[0].text).toContain('Available builds:');
      expect(result.content[0].text).toContain('1. build1.xml');
      expect(result.content[0].text).toContain('2. build2.xml');
      expect(result.content[0].text).toContain('3. league/starter.xml');
    });

    it('should return message when no builds found', async () => {
      mockBuildService.listBuilds.mockResolvedValue([]);

      const result = await handleListBuilds(context);

      expect(result.content).toHaveLength(1);
      expect(result.content[0].text).toContain('No builds found');
    });
  });

  describe('handleAnalyzeBuild', () => {
    const mockBuild: PoBBuild = {
      Build: {
        className: 'Ranger',
        ascendClassName: 'Deadeye',
        level: '90',
      },
    };

    it.each(['Init Test', ''])('does not overwrite a potentially edited current build: %s', async (name) => {
      mockBuildService.readBuild.mockResolvedValue(mockBuild);
      mockBuildService.generateBuildSummary.mockReturnValue('Build Summary');
      mockTreeService.analyzePassiveTree.mockResolvedValue(null);
      const loadBuildXml = jest.fn();
      context.getLuaClient = () => ({ getBuildInfo: async () => ({ name }), loadBuildXml }) as unknown as ReturnType<typeof context.getLuaClient>;
      await handleAnalyzeBuild(context, 'test.xml');
      expect(loadBuildXml).not.toHaveBeenCalled();
    });

    it('preserves the current build when its state cannot be read', async () => {
      mockBuildService.readBuild.mockResolvedValue(mockBuild);
      mockBuildService.generateBuildSummary.mockReturnValue('Build Summary');
      mockTreeService.analyzePassiveTree.mockResolvedValue(null);
      const loadBuildXml = jest.fn();
      context.getLuaClient = () => ({ getBuildInfo: async () => { throw new Error('unavailable'); }, loadBuildXml }) as unknown as ReturnType<typeof context.getLuaClient>;
      await handleAnalyzeBuild(context, 'test.xml');
      expect(loadBuildXml).not.toHaveBeenCalled();
    });

    it('should return build summary with tree analysis', async () => {
      mockBuildService.readBuild.mockResolvedValue(mockBuild);
      mockBuildService.generateBuildSummary.mockReturnValue('=== Build Summary ===\nClass: Ranger');
      mockTreeService.analyzePassiveTree.mockResolvedValue({
        treeVersion: '3_28',
        buildVersion: '3_28',
        versionMismatch: false,
        totalPoints: 95,
        availablePoints: 100,
        allocatedNodes: [],
        keystones: [{ skill: 123, name: 'Point Blank', stats: ['50% more Projectile Damage at Close Range'], isKeystone: true }],
        notables: [],
        jewels: [],
        normalNodes: [],
        invalidNodeIds: [],
        archetype: 'physical-attack',
        archetypeConfidence: 'high',
        pathingEfficiency: 'good',
        optimizationSuggestions: [],
      });

      const result = await handleAnalyzeBuild(context, 'test.xml');

      expect(mockBuildService.readBuild).toHaveBeenCalledWith('test.xml');
      expect(mockBuildService.generateBuildSummary).toHaveBeenCalledWith(mockBuild);
      expect(mockTreeService.analyzePassiveTree).toHaveBeenCalledWith(mockBuild);
      expect(result.content).toHaveLength(1);
      expect(result.content[0].text).toContain('Build Summary');
      expect(result.content[0].text).toContain('Passive Tree');
      expect(result.content[0].text).toContain('Point Blank');
    });

    it('should handle build without tree data', async () => {
      mockBuildService.readBuild.mockResolvedValue(mockBuild);
      mockBuildService.generateBuildSummary.mockReturnValue('=== Build Summary ===');
      mockTreeService.analyzePassiveTree.mockResolvedValue(null);

      const result = await handleAnalyzeBuild(context, 'test.xml');

      expect(result.content[0].text).toContain('No passive tree data found');
    });

    it('should handle invalid tree data error', async () => {
      mockBuildService.readBuild.mockResolvedValue(mockBuild);
      mockBuildService.generateBuildSummary.mockReturnValue('=== Build Summary ===');
      mockTreeService.analyzePassiveTree.mockRejectedValue(
        new Error('Invalid passive tree data detected: Node 99999 not found')
      );

      const result = await handleAnalyzeBuild(context, 'test.xml');

      expect(result.content[0].text).toContain('Invalid passive tree data detected');
      expect(result.content[0].text).toContain('Node 99999 not found');
    });

    it('should handle other tree analysis errors gracefully', async () => {
      mockBuildService.readBuild.mockResolvedValue(mockBuild);
      mockBuildService.generateBuildSummary.mockReturnValue('=== Build Summary ===');
      mockTreeService.analyzePassiveTree.mockRejectedValue(new Error('Network timeout'));

      const result = await handleAnalyzeBuild(context, 'test.xml');

      expect(result.content[0].text).toContain('Build Summary');
      expect(result.content[0].text).toContain('Passive tree analysis unavailable');
      expect(result.content[0].text).toContain('Network timeout');
    });

    it('should show version mismatch warning', async () => {
      mockBuildService.readBuild.mockResolvedValue(mockBuild);
      mockBuildService.generateBuildSummary.mockReturnValue('=== Build Summary ===');
      mockTreeService.analyzePassiveTree.mockResolvedValue({
        treeVersion: '3_28',
        buildVersion: '3_25',
        versionMismatch: true,
        totalPoints: 95,
        availablePoints: 100,
        allocatedNodes: [],
        keystones: [],
        notables: [],
        jewels: [],
        normalNodes: [],
        invalidNodeIds: [],
        archetype: 'unknown',
        archetypeConfidence: 'low',
        pathingEfficiency: 'good',
        optimizationSuggestions: [],
      });

      const result = await handleAnalyzeBuild(context, 'test.xml');

      expect(result.content[0].text).toContain('WARNING');
      expect(result.content[0].text).toContain('version 3_25');
      expect(result.content[0].text).toContain('version 3_28');
    });

    it('should not mark alternate tree raw node counts as impossible passive points', async () => {
      mockBuildService.readBuild.mockResolvedValue(mockBuild);
      mockBuildService.generateBuildSummary.mockReturnValue('=== Build Summary ===');
      mockTreeService.analyzePassiveTree.mockResolvedValue({
        treeVersion: '3_28_alternate',
        buildVersion: '3_28_alternate',
        versionMismatch: false,
        ascendancyName: 'Ancestral Commander',
        totalPoints: 118,
        availablePoints: 115,
        allocatedNodes: [
          { skill: 1, name: 'Ancestral Endurance', ascendancyName: 'Juggernaut' },
        ],
        keystones: [],
        notables: [],
        jewels: [],
        normalNodes: [],
        invalidNodeIds: [],
        archetype: 'unknown',
        archetypeConfidence: 'low',
        pathingEfficiency: 'good',
        optimizationSuggestions: [],
        passivePointEstimateReliable: false,
      });

      const result = await handleAnalyzeBuild(context, 'alternate.xml');
      const text = result.content[0].text;

      expect(text).toContain('Tree Version: 3_28_alternate');
      expect(text).toContain('Raw Non-Ascendancy Nodes: 118');
      expect(text).toContain('=== Ascendancy: Ancestral Commander');
      expect(text).not.toContain('=== Ascendancy: Juggernaut');
      expect(text).not.toContain('more points allocated than available');
      expect(text).not.toContain('not possible in the actual game');
    });

    it('should show optimization suggestions', async () => {
      mockBuildService.readBuild.mockResolvedValue(mockBuild);
      mockBuildService.generateBuildSummary.mockReturnValue('=== Build Summary ===');
      mockTreeService.analyzePassiveTree.mockResolvedValue({
        treeVersion: '3_28',
        buildVersion: '3_28',
        versionMismatch: false,
        totalPoints: 95,
        availablePoints: 100,
        allocatedNodes: [],
        keystones: [],
        notables: [],
        jewels: [],
        normalNodes: [],
        invalidNodeIds: [],
        archetype: 'physical-attack',
        archetypeConfidence: 'high',
        pathingEfficiency: 'good',
        optimizationSuggestions: [
          {
            type: 'path',
            title: 'Inefficient path detected',
            description: 'Consider using a more direct route',
            priority: 'high',
            pointsSaved: 2,
          },
          {
            type: 'reachable',
            title: 'Strong nearby notable',
            description: 'Constitution is only 3 points away',
            priority: 'medium',
            potentialGain: '+120 life',
          },
        ],
      });

      const result = await handleAnalyzeBuild(context, 'test.xml');

      expect(result.content[0].text).toContain('Optimization Suggestions');
      expect(result.content[0].text).toContain('High Priority');
      expect(result.content[0].text).toContain('Inefficient path detected');
      expect(result.content[0].text).toContain('Medium Priority');
      expect(result.content[0].text).toContain('Constitution');
    });
  });

  describe('handleCompareBuilds', () => {
    const build1: PoBBuild = {
      Build: {
        className: 'Ranger',
        ascendClassName: 'Deadeye',
        PlayerStat: [
          { stat: 'Life', value: '4500' },
          { stat: 'TotalDPS', value: '1000000' },
        ],
      },
    };

    const build2: PoBBuild = {
      Build: {
        className: 'Ranger',
        ascendClassName: 'Pathfinder',
        PlayerStat: [
          { stat: 'Life', value: '5000' },
          { stat: 'TotalDPS', value: '800000' },
        ],
      },
    };

    it('should compare two builds', async () => {
      mockBuildService.readBuild.mockResolvedValueOnce(build1).mockResolvedValueOnce(build2);

      const result = await handleCompareBuilds(context, 'build1.xml', 'build2.xml');

      expect(mockBuildService.readBuild).toHaveBeenCalledWith('build1.xml');
      expect(mockBuildService.readBuild).toHaveBeenCalledWith('build2.xml');
      expect(result.content).toHaveLength(1);
      expect(result.content[0].text).toContain('Build Comparison');
      expect(result.content[0].text).toContain('build1.xml');
      expect(result.content[0].text).toContain('build2.xml');
      expect(result.content[0].text).toContain('Deadeye vs Pathfinder');
    });

    it('should compare stats between builds', async () => {
      mockBuildService.readBuild.mockResolvedValueOnce(build1).mockResolvedValueOnce(build2);

      const result = await handleCompareBuilds(context, 'build1.xml', 'build2.xml');

      expect(result.content[0].text).toContain('Life: 4500 vs 5000');
      expect(result.content[0].text).toContain('TotalDPS: 1000000 vs 800000');
    });

    it.each(['Init Test', 'My Unsaved League Starter', 'build1'])(
      'preserves the current build %s when the isolated engine is unavailable', async (name) => {
        mockBuildService.readBuild.mockResolvedValueOnce(build1).mockResolvedValueOnce(build2);
        const loadBuildXml = jest.fn();
        context.getLuaClient = () => ({ getBuildInfo: async () => ({ name }), loadBuildXml }) as unknown as ReturnType<typeof context.getLuaClient>;
        context.createComparisonClient = async () => { throw new Error('unavailable'); };
        const result = await handleCompareBuilds(context, 'build1.xml', 'build2.xml');
        expect(loadBuildXml).not.toHaveBeenCalled();
        expect(result.content[0].text).toContain('XML / saved stats');
        expect(result.content[0].text).toContain('可能不是当前实时计算结果');
      },
    );

    it('closes the isolated engine after a failed comparison', async () => {
      mockBuildService.readBuild.mockResolvedValueOnce(build1).mockResolvedValueOnce(build2);
      const close = jest.fn(async () => undefined);
      context.createComparisonClient = async () => ({ client: { loadBuildXml: async () => { throw new Error('failed'); } } as any, close });
      const result = await handleCompareBuilds(context, 'build1.xml', 'build2.xml');
      expect(close).toHaveBeenCalledTimes(1);
      expect(result.content[0].text).toContain('XML / saved stats');
    });

    it('should report live DPS instead of N/A', async () => {
      // get_stats returns defence-only fields unless offensive ones are named,
      // which left the most important row of the comparison permanently blank.
      let requestedFields: string[] | undefined;
      const statsFor = (dps: number) => ({ Life: 4000, CombinedDPS: dps, CritChance: 50 });
      let call = 0;
      context.createComparisonClient = async () => ({ close: async () => undefined, client: ({
        loadBuildXml: async () => ({ ok: true }),
        listSpecs: async () => ({ specs: [] }),
        listItemSets: async () => ({ itemSets: [] }),
        getStats: async (fields?: string[]) => {
          requestedFields = fields;
          return statsFor(call++ === 0 ? 1_500_000 : 900_000);
        },
      }) as unknown as NonNullable<ReturnType<typeof context.getLuaClient>> });

      const result = await handleCompareBuilds(context, 'build1.xml', 'build2.xml');

      expect(requestedFields).toContain('CombinedDPS');
      expect(requestedFields).toContain('MinionCombinedDPS');
      expect(result.content[0].text).toContain((1_500_000).toLocaleString());
      expect(result.content[0].text).not.toMatch(/^\s*CombinedDPS[^\n]*N\/A/m);
    });

    it('compares poison-inclusive minion damage separately and does not rank missing values', async () => {
      let call = 0;
      context.createComparisonClient = async () => ({ close: async () => undefined, client: ({
        loadBuildXml: async () => ({}),
        listSpecs: async () => ({ specs: [] }), listItemSets: async () => ({ itemSets: [] }),
        getStats: async () => call++ === 0 ? { MinionCombinedDPS: 300, MinionTotalDPS: 200, Life: 0 } : { MinionCombinedDPS: 500, MinionTotalDPS: 200 },
      }) as unknown as NonNullable<ReturnType<typeof context.getLuaClient>> });
      const text = (await handleCompareBuilds(context, 'build1.xml', 'build2.xml')).content[0].text;
      expect(text).toMatch(/MinionCombinedDPS\s+300\s+vs\s+500\s+▲2/);
      expect(text).toMatch(/MinionTotalDPS\s+200\s+vs\s+200\s+=/);
      expect(text).toMatch(/Life\s+0\s+vs\s+N\/A\s+\?/);
    });

    it('should handle builds with single PlayerStat object', async () => {
      const singleStatBuild1 = {
        Build: {
          className: 'Witch',
          ascendClassName: 'Necromancer',
          PlayerStat: { stat: 'Life', value: '3000' },
        },
      };

      const singleStatBuild2 = {
        Build: {
          className: 'Witch',
          ascendClassName: 'Elementalist',
          PlayerStat: { stat: 'Life', value: '3500' },
        },
      };

      mockBuildService.readBuild
        .mockResolvedValueOnce(singleStatBuild1)
        .mockResolvedValueOnce(singleStatBuild2);

      const result = await handleCompareBuilds(context, 'build1.xml', 'build2.xml');

      expect(result.content[0].text).toContain('Life: 3000 vs 3500');
    });

    it('should handle builds without stats', async () => {
      const noStatsBuild1 = {
        Build: { className: 'Ranger', ascendClassName: 'Deadeye' },
      };
      const noStatsBuild2 = {
        Build: { className: 'Ranger', ascendClassName: 'Pathfinder' },
      };

      mockBuildService.readBuild
        .mockResolvedValueOnce(noStatsBuild1)
        .mockResolvedValueOnce(noStatsBuild2);

      const result = await handleCompareBuilds(context, 'build1.xml', 'build2.xml');

      expect(result.content[0].text).toContain('Build Comparison');
      expect(result.content[0].text).toContain('Deadeye vs Pathfinder');
    });
  });

  describe('handleGetBuildStats', () => {
    it('should return all stats from build', async () => {
      const build: PoBBuild = {
        Build: {
          PlayerStat: [
            { stat: 'Life', value: '5000' },
            { stat: 'EnergyShield', value: '0' },
            { stat: 'TotalDPS', value: '1500000' },
            { stat: 'FireResist', value: '75' },
          ],
        },
      };

      mockBuildService.readBuild.mockResolvedValue(build);

      const result = await handleGetBuildStats(context, 'test.xml');

      expect(result.content).toHaveLength(1);
      expect(result.content[0].text).toContain('Stats for test.xml');
      expect(result.content[0].text).toContain('Life: 5000');
      expect(result.content[0].text).toContain('EnergyShield: 0');
      expect(result.content[0].text).toContain('TotalDPS: 1500000');
      expect(result.content[0].text).toContain('FireResist: 75');
    });

    it('should handle single PlayerStat object', async () => {
      const build: PoBBuild = {
        Build: {
          PlayerStat: { stat: 'Life', value: '4000' },
        },
      };

      mockBuildService.readBuild.mockResolvedValue(build);

      const result = await handleGetBuildStats(context, 'test.xml');

      expect(result.content[0].text).toContain('Life: 4000');
    });

    it('should handle build without stats', async () => {
      const build: PoBBuild = {
        Build: {},
      };

      mockBuildService.readBuild.mockResolvedValue(build);

      const result = await handleGetBuildStats(context, 'test.xml');

      expect(result.content[0].text).toContain('No stats found');
    });
  });
});
