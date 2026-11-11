import { mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { PoBModifierData } from '../../src/adapters/modifierData/pobModifierData.js';

it('identifies the actual bytes and refreshes changed data even with the same size and timestamp', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'pob-mod-data-')), previous = process.env.POB_PATH;
  try {
    mkdirSync(path.join(dir, 'Data')); writeFileSync(path.join(dir, 'HeadlessWrapper.lua'), '-- engine marker\n');
    const file = path.join(dir, 'Data', 'ModExplicit.lua');
    const text = 'return {\n["x"] = { type = "Prefix", affix = "A", "+(1-5) to maximum Life", statOrder = { 1 }, level = 1, group = "Life", weightKey = { "default" }, weightVal = { 100 } },\n}';
    writeFileSync(file, text); process.env.POB_PATH = dir;
    const source = new PoBModifierData(), first = source.readExplicit(), timestamp = statSync(file);
    expect(first.sha256).toBe(createHash('sha256').update(readFileSync(file)).digest('hex'));
    expect(source.readExplicit().entries).toBe(first.entries);
    writeFileSync(file, text.replace('affix = "A"', 'affix = "B"')); utimesSync(file, timestamp.atime, timestamp.mtime);
    const second = source.readExplicit(); expect(second.sha256).not.toBe(first.sha256); expect(second.entries[0].affix).toBe('B');
  } finally { if (previous === undefined) delete process.env.POB_PATH; else process.env.POB_PATH = previous; rmSync(dir, { recursive: true, force: true }); }
});
