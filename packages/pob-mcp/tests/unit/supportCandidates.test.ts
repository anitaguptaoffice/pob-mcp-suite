import { describe, expect, it, jest } from '@jest/globals';
import { listSupportCandidates } from '../../src/features/supportCandidates/tool.js';
import type { PoBLuaApiClient } from '../../src/pobLuaBridge.js';

describe('PoB support candidates', () => {
  it('passes the selected group and filters through, and discloses incomplete checks', async () => {
    const getCompatibleSupports = jest.fn(async (_params: { groupIndex?: number; query?: string; limit?: number; includeExceptional?: boolean }) => ({
      groupIndex: 2, candidates: [{ id: 'id', name: 'Efficacy', exceptional: false, alreadySocketed: false }], total: 1, failed: 2,
    }));
    const client = { getBuildInfo: async () => ({ name: 'saved' }), getCompatibleSupports } as unknown as PoBLuaApiClient;
    const result = await listSupportCandidates({ pobDirectory: '/unused', getLuaClient: () => client, ensureLuaClient: async () => {} },
      { build_name: 'saved', skill_index: 1, count: 4, query: ' Efficacy ', include_exceptional: false, budget: 'endgame' });
    expect(getCompatibleSupports).toHaveBeenCalledWith({ groupIndex: 2, query: 'Efficacy', limit: 4, includeExceptional: false });
    expect(result.source).toBe('current_live_build');
    expect(result.warnings.join(' ')).toContain('2 个候选的兼容性检查失败');
    expect(result.warnings.join(' ')).toContain('预算参数未用于筛选');
  });
  it('rejects invalid limits before interacting with the engine', async () => {
    const ensureLuaClient = jest.fn(async () => {});
    await expect(listSupportCandidates({ pobDirectory: '/unused', getLuaClient: () => null, ensureLuaClient },
      { build_name: 'saved', count: 0 })).rejects.toThrow('count must be');
    expect(ensureLuaClient).not.toHaveBeenCalled();
  });
});
