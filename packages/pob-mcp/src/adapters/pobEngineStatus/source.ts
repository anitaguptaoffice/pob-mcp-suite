import type { EngineLimiter } from '../../foundation/engineLimiter.js';
import type { BuildEngine } from '../../foundation/buildFoundation.js';
import type { PoBEngineStatusSource } from '../../ports/pobEngineStatus.js';

export class PoBEngineStatusAdapter implements PoBEngineStatusSource {
  constructor(private readonly limiter: EngineLimiter<BuildEngine>) {}
  async inspect() {
    return this.limiter.withEngine(async engine => {
      const capabilities = await engine.getCapabilities();
      await engine.verifyIdentity();
      return { identity: engine.identity, capabilities };
    });
  }
}
