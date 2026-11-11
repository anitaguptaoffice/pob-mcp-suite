import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

it('keeps build imports in scripts and smoke tests backed by current TypeScript sources', () => {
  const root = resolve('.');
  let checked = 0;
  for (const folder of ['scripts', 'tests/smoke']) {
    for (const file of readdirSync(join(root, folder)).filter(name => name.endsWith('.mjs'))) {
      const content = readFileSync(join(root, folder, file), 'utf8');
      for (const match of content.matchAll(/\b(?:from\s+|import\s*\(\s*)['"]((?:\.\.\/)+build\/[^'"]+\.js)['"]/g)) {
        const source = match[1].split('/build/')[1].replace(/\.js$/, '.ts');
        expect({ file: `${folder}/${file}`, import: match[1], exists: existsSync(join(root, 'src', source)) }).toMatchObject({ exists: true });
        checked++;
      }
    }
  }
  expect(checked).toBeGreaterThan(0);
});
