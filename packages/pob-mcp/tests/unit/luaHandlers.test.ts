import { describe, it, expect, jest } from '@jest/globals';
import { handleLuaGetTree, type LuaHandlerContext } from '../../src/handlers/luaHandlers.js';

describe('LuaHandlers', () => {
  describe('handleLuaGetTree', () => {
    it('uses Lua-provided alternate ascendancy names instead of legacy ID mappings', async () => {
      const context: LuaHandlerContext = {
        pobDirectory: '/tmp/builds',
        luaEnabled: true,
        ensureLuaClient: jest.fn(async () => undefined),
        stopLuaClient: jest.fn(async () => undefined),
        getLuaClient: () => ({
          getTree: jest.fn(async () => ({
            treeVersion: '3_28_alternate',
            className: 'Marauder',
            classId: 1,
            ascendClassName: 'Ancestral Commander',
            ascendClassId: 1,
            secondaryAscendClassName: 'Chaos Bloodline',
            secondaryAscendClassId: 14,
            nodes: [32690, 27422, 25934],
            masteryEffects: {},
          })),
        } as any),
      };

      const result = await handleLuaGetTree(context, false);
      const text = result.content[0].text;

      expect(text).toContain('Tree Version: 3_28_alternate');
      expect(text).toContain('Class: Marauder (ID: 1)');
      expect(text).toContain('Ascendancy: Ancestral Commander (ID: 1)');
      expect(text).toContain('Secondary Ascendancy: Chaos Bloodline (ID: 14)');
      expect(text).not.toContain('Juggernaut');
    });
  });
});
