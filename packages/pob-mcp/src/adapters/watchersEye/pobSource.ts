import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import type { WatchersEyeSource } from '../../ports/watchersEyeSource.js';
import { resolvePoBLayout } from '../../utils/pobLayout.js';
import { parseWatchersEyeFile } from '../modifierData/modDataStore.js';

export class PoBWatchersEyeSource implements WatchersEyeSource {
  read() {
    const src = resolvePoBLayout(process.env.POB_PATH).src;
    const content = readFileSync(path.join(src, 'Data', 'Uniques', 'Special', 'WatchersEye.lua'));
    return { source: 'pob_watchers_eye' as const, sha256: createHash('sha256').update(content).digest('hex'), entries: parseWatchersEyeFile(content.toString('utf8')) };
  }
}
