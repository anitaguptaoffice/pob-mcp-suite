import { DEFAULT_TRIAL_TTL_MS, planSnapshotCollection, type RetentionNode } from '../../src/foundation/snapshotRetention.js';

const id = (number: number) => number.toString(16).padStart(64, '0');
const trial = (number: number, parent: number | null, expiresAt: string): RetentionNode => ({ id: id(number), parentId: parent === null ? null : id(parent), retention: { kind: 'trial', expiresAt } });

describe('snapshot retention planning', () => {
  const expired = '2026-01-01T00:00:00.000Z';
  const future = '2026-02-01T00:00:00.000Z';
  const now = Date.parse('2026-01-15T00:00:00.000Z');

  it('preserves old records, retained snapshots, job roots and all their ancestors', () => {
    const nodes: RetentionNode[] = [{ id: id(1), parentId: null }, trial(2, 1, expired), trial(3, 2, expired), trial(4, 2, expired), trial(5, 4, future), trial(6, 1, expired), trial(7, 1, expired), trial(8, 7, expired)];
    expect(planSnapshotCollection(nodes, new Set([id(3)]), new Set([id(6)]), now)).toEqual([id(8), id(7)]);
    expect(DEFAULT_TRIAL_TTL_MS).toBe(7 * 24 * 60 * 60 * 1000);
  });

  it('collects expired children before parents, including at the exact expiry', () => {
    const nodes = [trial(1, null, expired), trial(2, 1, expired), trial(3, 2, expired)];
    expect(planSnapshotCollection(nodes, new Set(), new Set(), Date.parse(expired))).toEqual([id(3), id(2), id(1)]);
  });

  it('rejects missing references, cycles, invalid expiry and duplicate nodes before planning deletion', () => {
    expect(() => planSnapshotCollection([trial(2, 1, expired)], new Set(), new Set(), now)).toThrow('missing parent');
    expect(() => planSnapshotCollection([trial(1, 2, expired), trial(2, 1, expired)], new Set(), new Set(), now)).toThrow('cycle');
    expect(() => planSnapshotCollection([trial(1, null, 'bad')], new Set(), new Set(), now)).toThrow('retention');
    expect(() => planSnapshotCollection([trial(1, null, expired), trial(1, null, expired)], new Set(), new Set(), now)).toThrow('graph');
    expect(() => planSnapshotCollection([], new Set([id(1)]), new Set(), now)).toThrow('missing');
  });
});
