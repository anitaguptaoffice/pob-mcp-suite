import { constants, promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { flockSync } from 'fs-ext';
import { atomicWriteFile } from '../utils/atomicWrite.js';

const protocol = 'pob-mcp/flock-v1';
interface LockMarker { protocol: string; token: string; pid: number; guard: { dev: string; ino: string } }

/** The guard inode is permanent: unlinking a flock file permits two writers. */
export async function acquireStoreLock(directory: string): Promise<() => Promise<void>> {
  await fs.mkdir(directory, { recursive: true });
  const guardPath = path.join(directory, '.writer.guard');
  const lockPath = path.join(directory, '.writer.lock');
  const file = await fs.open(guardPath, constants.O_CREAT | constants.O_RDWR | (constants.O_NOFOLLOW ?? 0), 0o600);
  const assertGuard = async () => {
    const [opened, current] = await Promise.all([file.stat({ bigint: true }), fs.lstat(guardPath, { bigint: true })]);
    if (!current.isFile() || opened.dev !== current.dev || opened.ino !== current.ino) throw new Error('Snapshot store lock guard changed; no recovery attempted');
    return { dev: opened.dev.toString(), ino: opened.ino.toString() };
  };
  const locked = () => new Error(`Snapshot store is locked: ${lockPath}`);
  try {
    try { flockSync(file.fd, 'exnb'); }
    catch (error) {
      if (['EAGAIN', 'EACCES', 'EWOULDBLOCK'].includes((error as NodeJS.ErrnoException).code ?? '')) throw locked();
      throw error;
    }
    const guard = await assertGuard();
    let previous: string | undefined;
    try { previous = await fs.readFile(lockPath, 'utf8'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    if (previous !== undefined) {
      let marker: Partial<LockMarker> | null = null;
      try { marker = JSON.parse(previous); } catch { /* Unrecognized or partial markers require manual recovery. */ }
      if (!marker || marker.protocol !== protocol || typeof marker.token !== 'string' ||
          !/^[a-f0-9-]{36}$/.test(marker.token) || marker.guard?.dev !== guard.dev || marker.guard?.ino !== guard.ino) {
        throw new Error(`Snapshot store is locked by an ambiguous or unrecognized marker: ${lockPath}. Stop all writers sharing this directory and remove only .writer.lock after verifying they have stopped. Never remove .writer.guard.`);
      }
      // Owning this same kernel lock proves a protocol-compliant owner is gone,
      // regardless of host/container PID namespaces. Recheck before replacing.
      await assertGuard();
      if (await fs.readFile(lockPath, 'utf8') !== previous) throw new Error('Snapshot store lock ownership changed; no recovery attempted');
      await fs.unlink(lockPath);
    }
    const marker: LockMarker = { protocol, token: randomUUID(), pid: process.pid, guard };
    await atomicWriteFile(lockPath, JSON.stringify(marker), false);
    await assertGuard();
    let released = false;
    return async () => {
      if (released) return;
      try {
        await assertGuard();
        if (await fs.readFile(lockPath, 'utf8') !== JSON.stringify(marker)) throw new Error('Snapshot store lock ownership changed');
        await fs.unlink(lockPath);
      } finally {
        released = true;
        await file.close();
      }
    };
  } catch (error) {
    await file.close();
    throw error;
  }
}
