/** Normalize only states whose equivalence is established by PoB's accessors. */
export function normalizeObservation<T>(value: T): T {
  const result = structuredClone(value) as any;
  if (Array.isArray(result?.skills?.groups)) {
    for (const group of result.skills.groups) {
      // Calcs.lua uses Lua truthiness for this flag: nil and false are both disabled.
      if (group.includeInFullDPS === undefined || group.includeInFullDPS === null) group.includeInFullDPS = false;
      // SkillsTab:LoadSkill defaults a missing selection to the first skill.
      if (group.mainActiveSkill === undefined || group.mainActiveSkill === null) group.mainActiveSkill = 1;
    }
  }
  if (Array.isArray(result?.items)) {
    for (const item of result.items) {
      // get_items emits active only when the slot has an activeItemSet entry.
      // For an empty slot only, absence and false both mean no active item.
      if (item.id === 0 && (item.active === undefined || item.active === null)) item.active = false;
    }
  }
  return result as T;
}
