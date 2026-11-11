declare module 'fs-ext' {
  export function flockSync(fd: number, flags: 'exnb' | 'un'): void;
}
