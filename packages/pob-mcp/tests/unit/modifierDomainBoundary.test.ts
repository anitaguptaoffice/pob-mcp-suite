import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

it('keeps modifier rules independent of the server and feature modules', () => {
  for (const file of ['src/domain/modifiers/affixMatcher.ts', 'src/domain/modifiers/affixQuery.ts', 'src/features/modifierData/tools.ts', 'src/adapters/modifierData/modDataStore.ts', 'src/adapters/modifierData/pobModifierData.ts', 'src/adapters/watchersEye/pobSource.ts']) {
    const source = readFileSync(resolve(file), 'utf8');
    const imports = [...source.matchAll(/\b(?:from\s*|import\s*\()\s*['"]([^'"]+)['"]/g)].map(match => match[1]);
    expect(imports.filter(path => /(?:^|\/)(?:services|handlers)(?:\/|$)|toolRouter/.test(path))).toEqual([]);
  }
});
