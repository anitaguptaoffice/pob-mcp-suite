import { EngineLimiter } from '../../src/foundation/engineLimiter.js';
import { PoBEngineStatusAdapter } from '../../src/adapters/pobEngineStatus/source.js';
import { createEngineStatusTool } from '../../src/features/engineStatus/tool.js';
import type { BuildEngine } from '../../src/foundation/buildFoundation.js';
import type { PoBEngineStatusSource } from '../../src/ports/pobEngineStatus.js';

it('reports actual internal actions without starting a build and closes the engine', async () => {
  const getCapabilities = jest.fn().mockResolvedValue({ mode: 'native', adapter: 'test', actions: ['get_stats'] });
  const verifyIdentity = jest.fn(), close = jest.fn();
  const engine = { getCapabilities, verifyIdentity, close, identity: { engineVersion: 'v', adapterVersion: 'a', dataVersion: 'd' } } as unknown as BuildEngine;
  const tool = createEngineStatusTool(new PoBEngineStatusAdapter(new EngineLimiter(async () => engine)));
  const result = JSON.parse((await tool.invoke({})).content[0].text);
  expect(result.bridge.actions).toEqual(['get_stats']); expect(result.bridge.reported).toBe(true);
  expect(result.identityUnknown).toContain('runtimeVersion'); expect(verifyIdentity).toHaveBeenCalledTimes(1); expect(close).toHaveBeenCalledTimes(1);
});
it('leaves unreported capabilities unknown and refuses malformed responses', async () => {
  const inspect = jest.fn().mockResolvedValue({ identity: {}, capabilities: { capabilitiesReported: false } });
  const tool = createEngineStatusTool({ inspect } as unknown as PoBEngineStatusSource);
  const result = JSON.parse((await tool.invoke({})).content[0].text);
  expect(result.bridge.actions).toBeNull(); expect(result.bridge.reported).toBe(false);
  inspect.mockResolvedValueOnce({ identity: {}, capabilities: { actions: [42] } });
  await expect(tool.invoke({})).rejects.toThrow('invalid capability');
  await expect(tool.invoke({ unexpected: true })).rejects.toThrow('No engine status');
});
it('closes the engine when verification fails', async () => {
  const close = jest.fn(), engine = { getCapabilities: jest.fn().mockResolvedValue({}), verifyIdentity: jest.fn().mockRejectedValue(new Error('changed')), close } as unknown as BuildEngine;
  await expect(new PoBEngineStatusAdapter(new EngineLimiter(async () => engine)).inspect()).rejects.toThrow('changed'); expect(close).toHaveBeenCalledTimes(1);
});
it('does not claim availability when engine startup fails', async () => {
  const limiter = new EngineLimiter<BuildEngine>(async () => { throw new Error('engine unavailable'); });
  await expect(new PoBEngineStatusAdapter(limiter).inspect()).rejects.toThrow('engine unavailable');
});
