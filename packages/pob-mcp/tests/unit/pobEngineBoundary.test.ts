import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

it('keeps the engine contract and migrated readers independent of the Lua bridge implementation', () => {
  for (const file of ['src/ports/pobEngine.ts', 'src/foundation/buildFoundation.ts', 'src/features/ailments/tool.ts', 'src/features/buildIssues/tool.ts', 'src/features/buildSummary/tool.ts', 'src/features/equipmentAnalysis/tool.ts']) {
    const text = readFileSync(resolve(file), 'utf8');
    const imports = [...text.matchAll(/\b(?:from\s*|import\s*\()\s*['"]([^'"]+)['"]/g)].map(match => match[1]);
    expect(imports.filter(name => /pobLuaBridge|(?:^|\/)services\//.test(name))).toEqual([]);
  }
});

it('keeps the PoB adapter independent of legacy bridge and foundation paths', () => {
  for (const file of ['src/adapters/pob/bridge.ts', 'src/adapters/pob/engine.ts', 'src/infrastructure/contentDigest.ts', 'src/infrastructure/executableIdentity.ts']) {
    const text = readFileSync(resolve(file), 'utf8');
    const imports = [...text.matchAll(/\b(?:from\s*|import\s*\()\s*['"]([^'"]+)['"]/g)].map(match => match[1]);
    expect(imports.filter(name => /pobLuaBridge|(?:^|\/)(?:foundation|services|handlers)\//.test(name))).toEqual([]);
  }
});
