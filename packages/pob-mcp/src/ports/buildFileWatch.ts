export type BuildFileChangeType = 'added' | 'modified' | 'deleted';
export interface BuildFileChange { sequence: number; path: string; type: BuildFileChangeType; observedAt: string }
export interface BuildFileWatchStatus { state: 'stopped' | 'starting' | 'running' | 'stopping' | 'failed'; directory: string; sessionId: string; latestSequence: number; oldestSequence: number | null; error: string | null }
export interface BuildFileWatch {
  start(): Promise<BuildFileWatchStatus>;
  stop(): Promise<BuildFileWatchStatus>;
  status(): BuildFileWatchStatus;
  changes(afterSequence: number, limit: number): { status: BuildFileWatchStatus; events: BuildFileChange[]; nextSequence: number; lostBefore: boolean };
}
