/** Legacy examples only; these are not maintained as versioned game data. */
export const ACT_MILESTONES = [
  { act: 1, level: 12, label: 'End of Act 1 (Merveil)' },
  { act: 2, level: 22, label: 'End of Act 2 (Vaal Oversoul)' },
  { act: 3, level: 32, label: 'End of Act 3 (Dominus)' },
  { act: 4, level: 40, label: 'End of Act 4 (Malachai)' },
  { act: 5, level: 46, label: 'End of Act 5 (Kitava)' },
  { act: 6, level: 52, label: 'End of Act 6 (Tsoagoth)' },
  { act: 7, level: 58, label: 'End of Act 7 (Arakaali)' },
  { act: 8, level: 64, label: 'End of Act 8 (Lunaris & Solaris)' },
  { act: 9, level: 68, label: 'End of Act 9 (The Depraved Trinity)' },
  { act: 10, level: 70, label: 'End of Act 10 / Maps (Kitava)' },
];

export const CLASS_STARTER_SKILLS: Record<string, { early: string; links: string[] }> = {
  Marauder: { early: 'Infernal Blow or Heavy Strike', links: ['Maim Support', 'Onslaught Support'] },
  Ranger: { early: 'Splitting Steel or Burning Arrow', links: ['Pierce Support', 'Lesser Multiple Projectiles'] },
  Witch: { early: 'Freezing Pulse or Arc', links: ['Arcane Surge Support', 'Added Lightning Damage'] },
  Duelist: { early: 'Cleave or Splitting Steel', links: ['Maim Support', 'Onslaught Support'] },
  Templar: { early: 'Holy Flame Totem or Arc', links: ['Arcane Surge Support', 'Controlled Destruction'] },
  Shadow: { early: 'Viper Strike or Freezing Pulse', links: ['Added Chaos Damage', 'Onslaught Support'] },
  Scion: { early: 'Cleave or Arc', links: ['Onslaught Support', 'Added Lightning Damage'] },
};

export const ASCENDANCY_UNLOCK = { normal: 36, cruel: 55, merciless: 68 };
