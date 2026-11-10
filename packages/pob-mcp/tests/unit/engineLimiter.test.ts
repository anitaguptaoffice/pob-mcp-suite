import { EngineLimiter } from '../../src/foundation/engineLimiter.js';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

describe('EngineLimiter', () => {
  it('bounds running and waiting operations and transfers a released slot', async () => {
    const firstGate = deferred();
    const started = deferred();
    let open = 0;
    let peak = 0;
    const limiter = new EngineLimiter(async () => {
      open++; peak = Math.max(peak, open);
      return { close: async () => { open--; } };
    }, 1, 1);
    const first = limiter.withEngine(async () => { started.resolve(); await firstGate.promise; return 1; });
    await started.promise;
    const second = limiter.withEngine(async () => 2);
    await expect(limiter.withEngine(async () => 3)).rejects.toThrow('queue is full');
    firstGate.resolve();
    expect(await Promise.all([first, second])).toEqual([1, 2]);
    expect(peak).toBe(1);
    expect(open).toBe(0);
  });

  it('releases capacity after start, execution and close failures', async () => {
    let attempts = 0;
    const limiter = new EngineLimiter(async () => {
      attempts++;
      if (attempts === 1) throw new Error('start');
      const current = attempts;
      return { close: async () => { if (current === 2) throw new Error('close'); } };
    }, 1, 0);
    await expect(limiter.withEngine(async () => 1)).rejects.toThrow('start');
    await expect(limiter.withEngine(async () => { throw new Error('run'); })).rejects.toThrow('Engine operation and cleanup failed');
    await expect(limiter.withEngine(async () => 3)).resolves.toBe(3);
  });
  it('removes cancelled queued work without consuming a later slot', async () => {
    const gate = deferred();
    const started = deferred();
    let created = 0;
    const limiter = new EngineLimiter(async () => { created++; return { close: async () => {} }; }, 1, 1);
    const first = limiter.withEngine(async () => { started.resolve(); await gate.promise; });
    await started.promise;
    const controller = new AbortController();
    const cancelled = limiter.withEngine(async () => 1, controller.signal);
    controller.abort(new Error('cancelled'));
    await expect(cancelled).rejects.toThrow('cancelled');
    const next = limiter.withEngine(async () => 2);
    gate.resolve();
    await first;
    await expect(next).resolves.toBe(2);
    expect(created).toBe(2);
  });
  it('closes a newly created engine when cancelled during startup', async () => {
    const gate = deferred();
    const started = deferred();
    const controller = new AbortController();
    let closed = false;
    const limiter = new EngineLimiter(async () => {
      started.resolve();
      await gate.promise;
      return { close: async () => { closed = true; } };
    }, 1, 0);
    const pending = limiter.withEngine(async () => 1, controller.signal);
    await started.promise;
    controller.abort(new Error('cancelled during start'));
    gate.resolve();
    await expect(pending).rejects.toThrow('cancelled during start');
    expect(closed).toBe(true);
    await expect(limiter.withEngine(async () => 2)).resolves.toBe(2);
  });
});
