import type { BuildEngine } from '../../ports/pobEngine.js';
import type { EngineLimiter } from '../../foundation/engineLimiter.js';
import type { PoBItemDataSource } from '../../ports/pobItemDataSource.js';

/** A disposable scratch engine exposes PoB's item data without any user build. */
export class PoBItemDataAdapter implements PoBItemDataSource {
  constructor(private readonly limiter: EngineLimiter<BuildEngine>) {}
  async weight(modId: string, itemText: string) {
    return this.limiter.withEngine(async engine => {
      await engine.newBuild();
      const result = await engine.getItemAffixWeight(modId, itemText);
      await engine.verifyIdentity();
      return { result, identity: engine.identity };
    });
  }
}
