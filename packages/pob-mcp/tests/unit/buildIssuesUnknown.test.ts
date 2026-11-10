import { describe, expect, it } from '@jest/globals';
import { handleGetBuildIssues } from '../../src/handlers/buildGoalsHandlers.js';

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
});
