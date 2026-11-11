import { inflateRawSync, inflateSync } from 'node:zlib';

export const MAX_BUILD_BYTES = 16 * 1024 * 1024;
const MAX_SHARE_CODE_LENGTH = 8 * 1024 * 1024;

/** Decode PoB's URL-safe base64/zlib format with bounded input and output. */
export function decodeShareCode(input: string): string {
  const code = input.trim();
  if (!code || code.length > MAX_SHARE_CODE_LENGTH || !/^[A-Za-z0-9_+/-]+={0,2}$/.test(code)) {
    throw new Error('Invalid or oversized PoB share code');
  }
  const base64 = code.replace(/-/g, '+').replace(/_/g, '/');
  const bytes = Buffer.from(base64, 'base64');
  const canonical = bytes.toString('base64').replace(/=+$/, '');
  if (canonical !== base64.replace(/=+$/, '')) throw new Error('Invalid PoB share code encoding');
  let decompressed: Buffer;
  try { decompressed = inflateSync(bytes, { maxOutputLength: MAX_BUILD_BYTES }); }
  catch {
    try { decompressed = inflateRawSync(bytes, { maxOutputLength: MAX_BUILD_BYTES }); }
    catch { throw new Error('PoB share code could not be decompressed within the size limit'); }
  }
  try { return new TextDecoder('utf-8', { fatal: true }).decode(decompressed); }
  catch { throw new Error('PoB share code contains invalid UTF-8'); }
}
