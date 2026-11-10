/** Immutable retention metadata is part of a snapshot's content identity. */
export interface TrialRetention { kind: 'trial'; expiresAt: string }
export interface RetentionNode { id: string; parentId: string | null; retention?: TrialRetention }

export const DEFAULT_TRIAL_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Plan collection only; the caller must hold exclusive ownership and verify
 * every input record and retained marker before making any filesystem changes.
 * Records without trial metadata are durable for backwards compatibility.
 */
export function planSnapshotCollection(nodes: readonly RetentionNode[], retained: ReadonlySet<string>, protectedIds: ReadonlySet<string>, now: number): string[] {
  if (!Number.isFinite(now)) throw new Error('Invalid retention clock');
  const byId = new Map<string, RetentionNode>();
  const pattern = /^[a-f0-9]{64}$/;
  for (const node of nodes) {
    if (!node || !pattern.test(node.id) || byId.has(node.id) || (node.parentId !== null && !pattern.test(node.parentId))) throw new Error('Invalid retention graph');
    if (node.retention !== undefined && (node.retention.kind !== 'trial' || typeof node.retention.expiresAt !== 'string' || !Number.isFinite(Date.parse(node.retention.expiresAt)) || new Date(node.retention.expiresAt).toISOString() !== node.retention.expiresAt)) throw new Error('Invalid trial retention');
    byId.set(node.id, node);
  }
  for (const id of [...retained, ...protectedIds]) if (!byId.has(id)) throw new Error('Retention root is missing');

  // Find depth for every node, including unreachable candidates, and reject
  // missing parents or cycles before calculating any deletion plan.
  const depths = new Map<string, number>();
  for (const id of byId.keys()) {
    let current: string | null = id;
    const chain: string[] = [];
    const visited = new Set<string>();
    while (current !== null && !depths.has(current)) {
      if (visited.has(current)) throw new Error('Retention graph contains a cycle');
      const node: RetentionNode | undefined = byId.get(current);
      if (!node) throw new Error('Retention graph has a missing parent');
      visited.add(current);
      chain.push(current);
      current = node.parentId;
    }
    let depth = current === null ? -1 : depths.get(current)!;
    for (let i = chain.length - 1; i >= 0; i--) depths.set(chain[i], ++depth);
  }

  const protectedNodes = new Set<string>();
  const roots = [...retained, ...protectedIds, ...nodes.filter(node => !node.retention || Date.parse(node.retention.expiresAt) > now).map(node => node.id)];
  for (const root of roots) {
    let current: string | null = root;
    while (current !== null && !protectedNodes.has(current)) {
      protectedNodes.add(current);
      current = byId.get(current)!.parentId;
    }
  }
  return nodes.filter(node => !protectedNodes.has(node.id)).map(node => node.id)
    .sort((a, b) => depths.get(b)! - depths.get(a)! || a.localeCompare(b));
}
