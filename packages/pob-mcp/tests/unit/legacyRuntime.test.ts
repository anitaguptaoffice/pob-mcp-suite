import { LegacyRuntime } from '../../src/server/legacyRuntime.js';

it('attempts both legacy cleanup operations even when one throws synchronously', async () => {
  const runtime = new LegacyRuntime('/tmp/pob-legacy-runtime-test', false, false);
  const internals = runtime as unknown as { watchService: { stopWatching(): void }; lua: { stopClient(): Promise<void> } };
  const watcher = jest.spyOn(internals.watchService, 'stopWatching').mockImplementation(() => { throw new Error('watch failed'); });
  const lua = jest.spyOn(internals.lua, 'stopClient').mockResolvedValue(undefined);
  await expect(runtime.close()).rejects.toThrow('Legacy runtime shutdown failed');
  expect(watcher).toHaveBeenCalledTimes(1);
  expect(lua).toHaveBeenCalledTimes(1);
});
