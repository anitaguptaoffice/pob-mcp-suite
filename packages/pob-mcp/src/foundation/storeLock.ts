import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

/** Exclusive directory ownership. A crash leaves a lock requiring explicit recovery. */
export async function acquireStoreLock(directory: string): Promise<() => Promise<void>> {
  await fs.mkdir(directory, { recursive: true });
  const lockPath = path.join(directory, '.writer.lock');
  const token = randomUUID();
  let file;
  try { file = await fs.open(lockPath, 'wx', 0o600); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new Error(`Snapshot store is locked: ${lockPath}`);
    throw error;
  }
  try { await file.writeFile(JSON.stringify({ token, pid: process.pid })); await file.sync(); }
  catch (error) {
    await file.close();
    await fs.unlink(lockPath).catch(() => {});
    throw error;
  }
  await file.close();
  let released = false;
  return async () => {
    if (released) return;
    const data = JSON.parse(await fs.readFile(lockPath, 'utf8')) as { token?: string };
    if (data.token !== token) throw new Error('Snapshot store lock ownership changed');
    await fs.unlink(lockPath);
    released = true;
  };
}
