type Gem = { index: number; kind: 'active' | 'support' | 'unknown'; enabled: boolean | null; appliedToSelectedSkill: boolean | null };
type Group = { enabled: boolean | null; slotEnabled: boolean | null; gems: Gem[] };

/** Summarize PoB observations without inferring socket links or damage gains. */
export function assessSkillGroup(group: Group) {
  const state = group.enabled === false || group.slotEnabled === false ? 'inactive' : group.enabled === true && group.slotEnabled === true ? 'active' : 'unknown';
  const enabled = group.gems.filter(gem => gem.enabled === true);
  const unknownEnabled = group.gems.filter(gem => gem.enabled === null).map(gem => gem.index);
  const unknownKinds = enabled.filter(gem => gem.kind === 'unknown').map(gem => gem.index);
  const active = enabled.filter(gem => gem.kind === 'active');
  const supports = enabled.filter(gem => gem.kind === 'support');
  const notApplied = state === 'active' ? supports.filter(gem => gem.appliedToSelectedSkill === false).map(gem => gem.index) : [];
  const unknownApplication = state === 'active' ? supports.filter(gem => gem.appliedToSelectedSkill === null).map(gem => gem.index) : [];
  const issues: string[] = [];
  if (state === 'active') {
    if (!enabled.length && !unknownEnabled.length) issues.push('no_enabled_gems');
    else if (!active.length && supports.length && !unknownKinds.length && !unknownEnabled.length) issues.push('only_support_gems');
    if (active.length > 1) issues.push('multiple_active_gems');
    if (notApplied.length) issues.push('support_not_applied');
    if (unknownApplication.length) issues.push('support_application_unknown');
  }
  return { state, enabledGemCount: unknownEnabled.length ? null : enabled.length, activeGemCount: unknownEnabled.length || unknownKinds.length ? null : active.length, supportGemCount: unknownEnabled.length || unknownKinds.length ? null : supports.length, unknownEnabledGemIndices: unknownEnabled, unknownKindGemIndices: unknownKinds, notAppliedSupportIndices: notApplied, unknownSupportApplicationIndices: unknownApplication, issues };
}
