import type { BuildFoundation } from '../../foundation/buildFoundation.js';
import type { FeatureTool } from '../../server/featureRegistry.js';
import { toFiniteNumber } from '../../pobLuaBridge.js';
import { isEquippableGearSlot, isGearSlotVisible } from '../../domain/itemAnalysis.js';

export const issueFields = ['Life', 'LifeUnreserved', 'EnergyShield', 'Mana', 'ManaUnreserved', 'ManaRegen', 'ManaRegenRecovery', 'HitChance', 'Accuracy', 'FireResist', 'ColdResist', 'LightningResist', 'ChaosResist', 'MissingFireResist', 'MissingColdResist', 'MissingLightningResist', 'FireResistOverCap', 'ColdResistOverCap', 'LightningResistOverCap', 'SpellSuppressionChance', 'EffectiveSpellSuppressionChance', 'TotalDPS', 'CombinedDPS', 'FullDPS', 'MinionTotalDPS', 'MinionCombinedDPS', 'TotalEHP'];
type Issue = { code: string; severity: 'error' | 'warning' | 'info'; category: string; message: string; evidence: Record<string, unknown>; heuristic?: boolean };
type Row = Record<string, unknown>;
const record = (value: unknown): Row | undefined => value && typeof value === 'object' && !Array.isArray(value) ? value as Row : undefined;

/** Evaluate declared checks only; absent inputs never become zero. */
export function analyzeBuildIssues(input: { stats: unknown; build: unknown; tree: unknown; items: unknown; skills: unknown }) {
  const stats = record(input.stats) ?? {}, build = record(input.build), tree = record(input.tree), skills = record(input.skills);
  const number = (key: string) => {
    const value = stats[key];
    return typeof value === 'number' || (typeof value === 'string' && value.trim() !== '') ? toFiniteNumber(value) : undefined;
  };
  const issues: Issue[] = [];
  const checks: Record<string, 'checked' | 'unknown' | 'not_applicable'> = {};
  const add = (code: string, severity: Issue['severity'], category: string, message: string, evidence: Row, heuristic = false) => issues.push({ code, severity, category, message, evidence, ...(heuristic ? { heuristic: true } : {}) });
  for (const element of ['Fire', 'Cold', 'Lightning']) {
    const value = number(`${element}Resist`), missing = number(`Missing${element}Resist`), over = number(`${element}ResistOverCap`);
    checks[`${element.toLowerCase()}Resistance`] = value === undefined || missing === undefined ? 'unknown' : 'checked';
    if (value !== undefined && value < 0) add(`${element.toLowerCase()}_resist_negative`, 'error', 'resistance', `${element} resistance is negative.`, { value });
    else if (value !== undefined && missing !== undefined && missing > 0) add(`${element.toLowerCase()}_resist_below_max`, 'warning', 'resistance', `${element} resistance is below its current maximum.`, { value, missing });
    if (over !== undefined && over > 0) add(`${element.toLowerCase()}_resist_over_cap`, 'info', 'resistance', `${element} resistance exceeds its current maximum; surplus can protect against resistance reductions.`, { overCap: over });
  }
  const chaos = number('ChaosResist'), level = typeof build?.level === 'number' && Number.isInteger(build.level) && build.level >= 1 && build.level <= 100 ? build.level : undefined;
  checks.chaosResistance = chaos === undefined ? 'unknown' : 'checked';
  if (chaos !== undefined && chaos < 0) {
    const severe = level !== undefined && ((level >= 80 && chaos < -20) || (level >= 70 && chaos < -30));
    add('chaos_resist_negative', severe ? 'error' : 'warning', 'resistance', 'Chaos resistance is negative.', { value: chaos, level: level ?? null }, severe);
  }
  const life = number('Life'), es = number('EnergyShield');
  checks.healthPool = life === undefined || es === undefined ? 'unknown' : 'checked';
  if (life !== undefined && es !== undefined && life < 500 && es < 500) add('low_health_pool', 'warning', 'survivability', 'Life and energy shield are both below 500.', { life, energyShield: es }, true);
  for (const [resource, key] of [['life', 'LifeUnreserved'], ['mana', 'ManaUnreserved']] as const) {
    const value = number(key); checks[`${resource}Reservation`] = value === undefined ? 'unknown' : 'checked';
    if (value !== undefined && (resource === 'life' ? value <= 0 : value < 0)) add(`${resource}_over_reserved`, 'error', 'reservation', `Unreserved ${resource} is ${resource === 'life' ? 'zero or negative' : 'negative'}.`, { value });
  }
  // These values describe PoB's current calculation, not the cost or accuracy
  // requirements of every enabled skill (or those of minions).
  const hitChance = number('HitChance');
  checks.playerHitChanceObservation = hitChance === undefined || hitChance < 0 || hitChance > 100 ? 'unknown' : 'checked';
  if (checks.playerHitChanceObservation === 'checked' && hitChance !== undefined && hitChance < 90) add('low_player_hit_chance', 'info', 'accuracy', 'PoB reports a player hit chance below 90%; first verify that this calculation and player accuracy apply to the damage being assessed.', { hitChance, accuracy: number('Accuracy') ?? null }, true);
  checks.manaRecoveryObservation = number('ManaRegen') === undefined && number('ManaRegenRecovery') === undefined ? 'unknown' : 'checked';
  const suppression = number('EffectiveSpellSuppressionChance') ?? number('SpellSuppressionChance');
  checks.spellSuppression = suppression === undefined ? 'unknown' : 'checked';
  if (suppression !== undefined && suppression > 0 && suppression < 100) add('suppression_below_100', 'info', 'defence', 'Spell suppression is below 100%.', { value: suppression });
  const damageKeys = ['TotalDPS', 'CombinedDPS', 'FullDPS', 'MinionTotalDPS', 'MinionCombinedDPS'];
  const damage = damageKeys.map(number);
  checks.zeroDamage = damage.some(v => v === undefined) ? 'unknown' : 'checked';
  if (damage.every(v => v === 0)) add('zero_damage', 'warning', 'gems', 'All checked damage outputs are zero; review the selected skill and configuration.', Object.fromEntries(damageKeys.map((key, i) => [key, damage[i]])));
  const nodes = tree?.nodes, treeVersion = tree?.treeVersion, ascendancyPoints = tree?.ascendancyPointsUsed;
  checks.passivePoints = level === undefined || !Array.isArray(nodes) || typeof treeVersion !== 'string' || typeof ascendancyPoints !== 'number' ? 'unknown' : treeVersion.includes('_alternate') ? 'not_applicable' : 'checked';
  if (checks.passivePoints === 'checked' && level !== undefined && level > 1 && Array.isArray(nodes) && typeof ascendancyPoints === 'number') {
    const allocated = nodes.length - 1 - (ascendancyPoints > 0 ? 1 : 0) - ascendancyPoints;
    const expected = level - 1 + (level >= 68 ? 24 : Math.min(24, Math.floor(level / 3)));
    const unspent = expected - allocated;
    if (unspent >= 5) add('estimated_unspent_passives', unspent >= 15 ? 'error' : 'warning', 'defence', 'Estimated unspent passive points; quest rewards and special tree mechanics may differ.', { estimatedUnspent: unspent, allocated, estimatedAvailable: expected, level, treeVersion }, true);
  }
  const items = Array.isArray(input.items) ? input.items.map(record) : undefined;
  checks.items = !items || items.some(item => !item || typeof item.slot !== 'string' || typeof item.id !== 'number') ? 'unknown' : 'checked';
  if (checks.items === 'checked' && items) {
    const rows = items as Row[];
    const emptyJewels = rows.filter(it => /jewel/i.test(it.slot as string) && it.shown !== false && it.id === 0).map(it => it.slot);
    if (emptyJewels.length) add('empty_jewel_sockets', 'warning', 'items', 'Visible jewel sockets are empty.', { slots: emptyJewels });
    for (const it of rows) if (it.id === 0 && isEquippableGearSlot(it.slot as string) && isGearSlotVisible(it.slot as string, { shown: typeof it.shown === 'boolean' ? it.shown : undefined }) && !/flask/i.test(it.slot as string)) add('empty_gear_slot', 'warning', 'items', 'A visible equipment slot is empty.', { slot: it.slot });
    const emptyFlasks = rows.filter(it => /flask/i.test(it.slot as string) && it.shown !== false && it.id === 0).map(it => it.slot);
    if (emptyFlasks.length) add('empty_flask_slots', emptyFlasks.length >= 3 ? 'error' : 'warning', 'items', 'Visible flask slots are empty.', { slots: emptyFlasks });
  }
  const groups = skills?.groups;
  checks.gemCoherence = !Array.isArray(groups) || groups.some(group => !record(group) || typeof group.enabled !== 'boolean' || !Array.isArray(group.gems) || group.gems.some((gem: unknown) => {
    const entry = record(gem);
    return !entry || typeof entry.enabled !== 'boolean' || typeof entry.isSupport !== 'boolean' || typeof entry.name !== 'string';
  })) ? 'unknown' : 'checked';
  if (checks.gemCoherence === 'checked' && Array.isArray(groups)) for (const group of groups) {
    if (!group.enabled) continue;
    const names: string[] = group.gems.filter((gem: Row) => gem.enabled && gem.isSupport && typeof gem.name === 'string').map((gem: Row) => (gem.name as string).toLowerCase());
    if (names.some(name => name.includes('brutality')) && names.some(name => /elemental|fire|cold|lightning|chaos|void manipulation/.test(name))) add('brutality_mixed_supports', 'warning', 'gems', 'Brutality prevents elemental and chaos damage; review the actual supported skill and conversion.', { groupIndex: group.index, supports: names }, true);
    if (names.some(name => name.includes('elemental damage with attacks')) && names.some(name => name.includes('melee physical'))) add('mixed_damage_supports', 'info', 'gems', 'The supports scale different damage types; review the skill damage breakdown.', { groupIndex: group.index, supports: names }, true);
  }
  return { issues, checks, stats };
}

export function buildIssuesSchema(): FeatureTool['schema'] {
  return { name: 'check_snapshot_issues', description: 'Run explicit heuristic checks against a snapshot using PoB stats, items, skills and its saved configuration. Missing inputs are reported as unknown.', inputSchema: { type: 'object', additionalProperties: false, properties: { snapshot_id: { type: 'string' } }, required: ['snapshot_id'] } };
}
export function createBuildIssuesTool(foundation: Pick<BuildFoundation, 'runReadOnlySnapshot'>): FeatureTool {
  return { schema: buildIssuesSchema(), invoke: async args => {
    if (Object.keys(args).some(key => key !== 'snapshot_id') || typeof args.snapshot_id !== 'string' || !/^[a-f0-9]{64}$/.test(args.snapshot_id)) throw new Error('Invalid snapshot issue scan options');
    const { result, ...context } = await foundation.runReadOnlySnapshot(args.snapshot_id, async engine => ({ stats: await engine.getStats(issueFields), build: await engine.getBuildInfo(), tree: await engine.getTree(), items: await engine.getItems(), skills: await engine.getSkills(), config: await engine.getConfig() }));
    return { content: [{ type: 'text', text: JSON.stringify({ ...context, ...analyzeBuildIssues(result), context: { build: result.build, treeVersion: record(result.tree)?.treeVersion ?? null, skills: result.skills, config: result.config }, warnings: [...context.warnings, 'This is a partial heuristic scan, not validation of item legality, damage assumptions, game mechanics or readiness. Unknown checks are not passes.', 'Thresholds and estimated quest points depend on progression and build mechanics; interpret them in context.', 'Player hit chance is not minion hit chance; check which skill PoB calculates. Mana recovery observations do not establish skill costs or sustained casting.'] }) }] };
  } };
}
