// Unversioned keyword heuristics; not proof of synergy or allocation.
// Notable → relevant build-type tags
export const CLUSTER_NOTABLE_TAGS: Record<string, string[]> = {
  'Feasting Fiends':       ['minion', 'leech'],
  'Renewal':               ['minion', 'life_regen'],
  'Vicious Bite':          ['minion', 'critical'],
  'Pure Agony':            ['minion', 'ailment'],
  'Disciples':             ['minion', 'aura'],
  'Dread March':           ['minion', 'movement'],
  'Hulking Corpses':       ['minion', 'tankiness'],
  'Heraldry':              ['herald', 'damage'],
  'Grand Design':          ['es', 'reservation'],
  'Flow of Life':          ['life', 'leech'],
  'Fearless Assault':      ['attack', 'stun'],
  'Martial Prowess':       ['attack', 'accuracy'],
  'Fuel the Fight':        ['attack', 'mana'],
  'Drive the Destruction': ['attack', 'damage'],
  'Force Multiplier':      ['attack', 'critical'],
  'Vengeful Commander':    ['aura', 'damage'],
  'Stalwart Commander':    ['aura', 'life'],
  'Precise Commander':     ['aura', 'critical'],
  'Wish for Death':        ['chaos', 'damage'],
  'Touch of Cruelty':      ['chaos', 'debuff'],
  'Wicked Pall':           ['chaos', 'damage'],
  'Unwaveringly Evil':     ['chaos', 'damage'],
  'Cold to the Core':      ['cold', 'penetration'],
  'Prismatic Heart':       ['cold', 'damage'],
  'Widespread Destruction':['area', 'damage'],
  'Smoking Remains':       ['fire', 'damage'],
  'Burning Bright':        ['fire', 'ignite'],
  'Snowforged':            ['cold', 'freeze'],
  'Stormrider':            ['lightning', 'shock'],
  'Supercharged':          ['lightning', 'critical'],
};

export function inferClusterArchetype(gemNames: string[]): string[] {
  const joined = gemNames.map(n => n.toLowerCase()).join(' ');
  const tags: string[] = [];
  if (/summon|relic|skeleton|spectre|golem/.test(joined)) tags.push('minion');
  if (/herald of/.test(joined)) tags.push('herald');
  if (/essence drain|bane|dark pact|caustic arrow/.test(joined)) tags.push('chaos');
  if (/fireball|scorching|ignite|cremation|incinerate/.test(joined)) tags.push('fire');
  if (/arc|storm brand|ball lightning|lightning/.test(joined)) tags.push('lightning');
  if (/frostbolt|ice nova|cold snap|freezing pulse/.test(joined)) tags.push('cold');
  if (/penance|righteous|sacred|ancestral/.test(joined)) tags.push('aura');
  return tags.length > 0 ? tags : ['generic'];
}

