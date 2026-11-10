/** Limits concurrent disposable engine leases and bounds the wait queue. */
export class EngineLimiter<T extends { close(): Promise<void> }> {
  private active = 0;
  private readonly waiting: Array<() => void> = [];

  constructor(private readonly create: () => Promise<T>, private readonly capacity = 2, private readonly maxWaiting = 16) {
    if (!Number.isInteger(capacity) || capacity < 1 || !Number.isInteger(maxWaiting) || maxWaiting < 0) {
      throw new Error('Invalid engine limiter capacity');
    }
  }

  private async acquire(signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted();
    if (this.active < this.capacity) { this.active++; return; }
    if (this.waiting.length >= this.maxWaiting) throw new Error('PoB engine queue is full');
    await new Promise<void>((resolve, reject) => {
      const onAbort = () => {
        const index = this.waiting.indexOf(ready);
        if (index !== -1) this.waiting.splice(index, 1);
        reject(signal?.reason ?? new Error('Engine wait cancelled'));
      };
      const ready = () => { signal?.removeEventListener('abort', onAbort); resolve(); };
      this.waiting.push(ready);
      signal?.addEventListener('abort', onAbort, { once: true });
      if (signal?.aborted) onAbort();
    });
  }

  private release(): void {
    const next = this.waiting.shift();
    if (next) next(); // Transfer the occupied slot directly to the next waiter.
    else this.active--;
  }

  async withEngine<R>(run: (engine: T) => Promise<R>, signal?: AbortSignal): Promise<R> {
    await this.acquire(signal);
    let engine: T | undefined;
    let operationError: unknown;
    let operationFailed = false;
    try {
      signal?.throwIfAborted();
      engine = await this.create();
      signal?.throwIfAborted();
      return await run(engine);
    } catch (error) {
      operationFailed = true;
      operationError = error;
      throw error;
    } finally {
      try {
        if (engine) await engine.close();
      } catch (closeError) {
        if (operationFailed) throw new AggregateError([operationError, closeError], 'Engine operation and cleanup failed');
        throw closeError;
      } finally { this.release(); }
    }
  }
}
