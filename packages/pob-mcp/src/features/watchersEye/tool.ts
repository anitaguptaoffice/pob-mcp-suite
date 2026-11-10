import type { BuildFoundation } from '../../foundation/buildFoundation.js';
import type { WatchersEyeSource } from '../../ports/watchersEyeSource.js';
import type { FeatureTool } from '../../server/featureRegistry.js';

const object = (x: unknown): x is Record<string, any> => !!x && typeof x === 'object' && !Array.isArray(x);
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export function watchersEyeSchema(): FeatureTool['schema'] {
  return { name: 'inspect_snapshot_watchers_eye', description: 'Find PoB Watcher\'s Eye modifier candidates matching saved skill-gem names and expose enabled states. Does not establish aura effect, current availability, prices or damage gain.', inputSchema: { type: 'object', additionalProperties: false, properties: { snapshot_id: { type: 'string' } }, required: ['snapshot_id'] } };
}
export function createWatchersEyeTool(foundation: Pick<BuildFoundation, 'inspect'>, source: WatchersEyeSource): FeatureTool {
  return { schema: watchersEyeSchema(), invoke: async args => {
    if (Object.keys(args).some(key => key !== 'snapshot_id') || typeof args.snapshot_id !== 'string' || !/^[a-f0-9]{64}$/.test(args.snapshot_id)) throw new Error('Valid snapshot ID is required');
    const file = source.read(), observation = await foundation.inspect(args.snapshot_id, ['skills']), after = source.read();
    if (file.sha256 !== after.sha256) throw new Error('PoB Watcher\'s Eye data changed during inspection');
    const skills = observation.data.skills;
    if (!object(skills) || !Array.isArray(skills.groups) || skills.groups.some((group: unknown) => !object(group) || !Number.isSafeInteger(group.index) || !Array.isArray(group.gems))) throw new Error('PoB returned invalid skill groups');
    const candidates: Array<Record<string, unknown>> = [];
    for (const group of skills.groups) for (const gem of group.gems) {
      if (!object(gem) || !Number.isSafeInteger(gem.index) || typeof gem.name !== 'string' || !gem.name.trim()) continue;
      if (gem.supportClassificationKnown === true && gem.isSupport === true) continue;
      const original = gem.name.trim(), isVaal = original.startsWith('Vaal '), aura = isVaal ? original.slice(5) : original;
      const matches = file.entries.filter(entry => entry.lines.some(line => new RegExp(`\\bwhile affected by ${escape(aura)}(?![A-Za-z])`, 'i').test(line)));
      if (!matches.length) continue;
      const switches = [group.enabled, group.slotEnabled, gem.enabled];
      const enabledState = switches.includes(false) ? 'disabled' : switches.every(value => value === true) && gem.supportClassificationKnown === true && gem.isSupport === false ? 'enabled_in_pob' : 'unknown';
      candidates.push({ groupIndex: group.index, gemIndex: gem.index, gemName: original, auraName: aura, matchKind: isVaal ? 'vaal_name_candidate' : 'exact_name', enabledState, modifiers: matches });
    }
    return { content: [{ type: 'text', text: JSON.stringify({ snapshotId: observation.snapshotId, identity: observation.identity, source: { name: file.source, sha256: file.sha256 }, candidates,
      warnings: [...observation.warnings, 'Enabled in PoB is not proof the character is affected by the aura; reservation, support effects, temporary states and game mechanics require verification.', 'Only socketed gem names are matched; item-granted skills, alternate names and external auras can be missing. An empty result does not prove no aura applies.', 'Vaal-name matches are candidates, not proof that the ordinary aura is active. Unknown or disabled states must not be presented as active.', 'PoB data can include legacy modifiers; matching a name does not establish current game availability, jewel roll legality, market price, synergy or damage gain.', 'No tier or optimal combination is inferred. Evaluate explicit candidate jewels in PoB and use official Trade sources separately.'] }) }] };
  } };
}
