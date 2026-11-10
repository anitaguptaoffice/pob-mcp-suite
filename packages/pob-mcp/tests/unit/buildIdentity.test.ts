import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { handleAnalyzeBuild } from '../../src/handlers/buildHandlers.js';
import { BOOTSTRAP_BUILD_NAME } from '../../src/server/bootstrapBuild.js';
import type { HandlerContext } from '../../src/utils/contextBuilder.js';
import { textOf } from '../helpers/response.js';

describe('analyze_build state isolation', () => {
  let directory: string;
  beforeEach(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'pob-identity-'));
    await fs.writeFile(path.join(directory, 'target.xml'), '<PathOfBuilding/>');
  });
  afterEach(async () => { await fs.rm(directory, { recursive: true, force: true }); });

  function fixture(loaded: string, source?: string) {
    const build = { Build: { level: '99' }, Skills: { activeSkillSet: '2' }, Items: {}, Tree: {} };
    const client = {
      getBuildInfo: async () => ({ name: loaded }), getLoadedFilePath: () => source,
      loadBuildXml: jest.fn(async () => ({})), getStats: jest.fn(async () => ({ Life: 6000 })),
      listSpecs: jest.fn(async () => ({ specs: [{ active: true, index: 1 }] })),
      listItemSets: jest.fn(async () => ({ itemSets: [{ active: true, id: 1 }] })),
    };
    const generateBuildSummary = jest.fn((_build: Parameters<HandlerContext['buildService']['generateBuildSummary']>[0]) => 'summary');
    const validateBuild = jest.fn((..._args: Parameters<HandlerContext['validationService']['validateBuild']>) => ({}));
    const context = {
      pobDirectory: directory, getLuaClient: () => client, ensureLuaClient: async () => {},
      buildService: { readBuild: async () => build, generateBuildSummary,
        parseConfiguration: () => null, parseFlasks: () => null, parseJewels: () => null },
      treeService: { analyzePassiveTree: async () => null },
      validationService: { validateBuild, formatValidation: () => 'validated' },
    };
    return { client, generateBuildSummary, validateBuild, context: context as unknown as HandlerContext };
  }

  it('preserves a bootstrap-named build that may have been edited', async () => {
    const f = fixture(BOOTSTRAP_BUILD_NAME);
    await handleAnalyzeBuild(f.context, 'target');
    expect(f.client.loadBuildXml).not.toHaveBeenCalled();
    expect(f.client.getStats).not.toHaveBeenCalled();
  });

  it('does not borrow any live stats or selections from a different source', async () => {
    const f = fixture('target', path.join(directory, 'other', 'target.xml'));
    const result = await handleAnalyzeBuild(f.context, 'target');
    expect(f.client.loadBuildXml).not.toHaveBeenCalled();
    expect(f.client.getStats).not.toHaveBeenCalled();
    expect(f.client.listSpecs).not.toHaveBeenCalled();
    expect(f.client.listItemSets).not.toHaveBeenCalled();
    expect(f.validateBuild.mock.calls[0]?.[2]).toBeUndefined();
    expect(textOf(result)).toContain('requested saved file');
  });

  it('analyzes another saved build in isolation and preserves the current bridge', async () => {
    const f = fixture('different');
    const close = jest.fn(async () => undefined);
    const isolatedClient = {
      loadBuildXml: jest.fn(async () => ({})),
      getStats: jest.fn(async (_fields: string[]) => ({ Life: 6000, MinionCombinedDPS: 250, EnergyShield: 0 })),
      listSpecs: async () => ({ specs: [] }), listItemSets: async () => ({ itemSets: [] }),
    };
    f.context.createIsolatedLuaClient = async () => ({ client: isolatedClient as any, close });
    const result = await handleAnalyzeBuild(f.context, 'target');
    expect(f.client.loadBuildXml).not.toHaveBeenCalled();
    expect(isolatedClient.loadBuildXml).toHaveBeenCalled();
    expect(isolatedClient.getStats.mock.calls[0][0]).toContain('MinionCombinedDPS');
    expect(textOf(result)).toContain('Minion Combined DPS: 250');
    expect(textOf(result)).toContain('Energy Shield: 0');
    expect(textOf(result)).toContain('isolated engine');
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('closes the isolated bridge when loading the requested file fails', async () => {
    const f = fixture('different');
    const close = jest.fn(async () => undefined);
    f.context.createIsolatedLuaClient = async () => ({ client: { loadBuildXml: async () => { throw new Error('failed'); } } as any, close });
    const result = await handleAnalyzeBuild(f.context, 'target');
    expect(close).toHaveBeenCalledTimes(1);
    expect(textOf(result)).toContain('requested saved file');
    expect(f.client.loadBuildXml).not.toHaveBeenCalled();
  });

  it('does not use the item-set ID as a skill-set ID', async () => {
    const f = fixture('target', path.join(directory, 'target.xml'));
    await handleAnalyzeBuild(f.context, 'target');
    expect(f.generateBuildSummary.mock.calls[0]?.[0].Skills?.activeSkillSet).toBe('2');
  });
});
