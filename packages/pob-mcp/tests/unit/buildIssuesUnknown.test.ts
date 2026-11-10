import { describe, expect, it } from '@jest/globals';
import { formatIssuesResponse, handleGetBuildIssues } from '../../src/handlers/buildGoalsHandlers.js';

describe('build issue data integrity', () => {
  it('does not treat missing stats, alternate-tree points or hidden jewel slots as failures', async () => {
    const client = {
      getStats: async () => ({}), getBuildInfo: async () => ({ level: 90 }),
      getTree: async () => ({ treeVersion: '3_28_alternate', nodes: [], ascendancyPointsUsed: 0 }),
      getItems: async () => [{ slot: 'Jewel 1', id: 0, shown: false }], getSkills: async () => ({ groups: [] }),
    };
    const ctx = { getLuaClient: () => client, ensureLuaClient: async () => {} } as unknown as Parameters<typeof handleGetBuildIssues>[0];
    const result = await handleGetBuildIssues(ctx);
    const messages = result.issues.map(issue => issue.message).join('\n');
    expect(messages).not.toMatch(/resist 0%|Low health pool|Unreserved life is 0|does 0 DPS|passive points appear unspent|jewel socket/);
  });
  it('distinguishes missing resistances and damage from actual zero values', () => {
    const text = formatIssuesResponse([], { FireResist: 0, TotalDPS: 100, CombinedDPS: 0 }).content[0].text;
    expect(text).toContain('火焰抗性: 0%');
    expect(text).toContain('冰霜抗性: 未提供');
    expect(text).toContain('TotalDPS: 100');
    expect(text).toContain('CombinedDPS: 0');
    expect(text).toContain('MinionTotalDPS: 未提供');
    expect(text).not.toContain('Build looks healthy');
  });
  it('does not call minion damage zero when combined damage is positive', async () => {
    const client = { getStats: async () => ({ TotalDPS: 0, CombinedDPS: 0, MinionTotalDPS: 0, MinionCombinedDPS: 25 }), getBuildInfo: async () => ({ level: 1 }), getTree: async () => ({ nodes: [] }), getItems: async () => [], getSkills: async () => ({ groups: [] }) };
    const ctx = { getLuaClient: () => client, ensureLuaClient: async () => {} } as unknown as Parameters<typeof handleGetBuildIssues>[0];
    const result = await handleGetBuildIssues(ctx);
    expect(result.issues.some(issue => issue.message.includes('does 0 DPS'))).toBe(false);
  });
});
