import { describe, expect, it, jest } from '@jest/globals';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { XMLParser } from 'fast-xml-parser';
import { analyzeEquippedItems, formatItemAnalysis } from '../../src/itemAnalyzer.js';
import { handleAnalyzeItems, handleCreateBudgetBuild, handleOptimizeSkillLinks } from '../../src/handlers/advancedOptimizationHandlers.js';
import { handleGemUpgradePath } from '../../src/handlers/skillGemHandlers.js';

describe('advanced analysis data integrity', () => {
  it('does not invent missing resistances or infer CI from missing life', () => {
    const analysis = analyzeEquippedItems([{ slot: 'Ring 1', name: 'Ring' }], 'Witch', undefined, { energyShield: 1000 });
    const text = formatItemAnalysis(analysis);
    expect(text).not.toContain('Fire Resistance: 0%');
    expect(text).not.toContain('Resistances may not be capped');
    expect(text).not.toContain('Build Type: ci-es');
  });

  it('recognizes measured zero resistance as a real value', () => {
    const text = formatItemAnalysis(analyzeEquippedItems([{ slot: 'Ring 1', name: 'Ring' }], 'Witch', undefined,
      { fireRes: 0, coldRes: 75, lightningRes: 75 }));
    expect(text).toContain('Fire Resistance: 0%');
  });

  it('maps saved XML stats without making malformed or missing stats zero', async () => {
    const build = { Build: { className: 'Witch', PlayerStat: [{ stat: 'FireResist', value: '60' }, { stat: 'ColdResist', value: 'invalid' }] },
      Items: { Item: [{ id: '1', '#text': 'Rarity: Rare\nTest Ring\nRuby Ring' }], ItemSet: { Slot: [{ name: 'Ring 1', itemId: '1' }] } } };
    const context = { pobDirectory: '', ensureLuaClient: async () => { throw new Error('offline'); }, getLuaClient: () => null,
      buildService: { readBuild: async () => build } } as unknown as Parameters<typeof handleAnalyzeItems>[0];
    const text = (await handleAnalyzeItems(context, 'saved')).content[0].text;
    expect(text).toContain('Fire Resistance: 60%');
    expect(text).not.toContain('Cold Resistance: 0%');
    expect(text).toContain('未进行实时计算');
  });

  it('does not substitute saved skills for an empty live skill set', async () => {
    const readBuild = jest.fn(async () => ({ Skills: { SkillSet: { Skill: [{ Gem: { name: 'Vortex' } }] } } }));
    const client = { getBuildInfo: async () => ({ name: 'saved' }), getSkills: async () => ({ groups: [] }),
      getTree: async () => ({ classId: 3 }), getStats: async () => ({ Life: 100 }) };
    const context = { pobDirectory: '/unused', ensureLuaClient: async () => {}, getLuaClient: () => client,
      buildService: { readBuild } } as unknown as Parameters<typeof handleOptimizeSkillLinks>[0];
    const text = (await handleOptimizeSkillLinks(context, 'saved')).content[0].text;
    expect(text).toContain('No skill groups found');
    expect(text).toContain('当前内存构筑');
    expect(readBuild).not.toHaveBeenCalled();
  });

  it('reads nameSpec and support types from a real PoB XML fixture', async () => {
    const xml = readFileSync(path.resolve('tests/fixtures/occ-vortex.xml'), 'utf8');
    const build = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '' }).parse(xml).PathOfBuilding;
    const context = { pobDirectory: '', ensureLuaClient: async () => { throw new Error('offline'); }, getLuaClient: () => null,
      buildService: { readBuild: async () => build } } as unknown as Parameters<typeof handleOptimizeSkillLinks>[0];
    const text = (await handleOptimizeSkillLinks(context, 'fixture')).content[0].text;
    expect(text).toContain('Group 5 (MAIN)');
    expect(text).toContain('Vortex（主动）');
    expect(text).toContain('Controlled Destruction（辅助）');
    expect(text).not.toContain('Gems: Unknown');
    expect(text).not.toContain('均标识为辅助宝石');
    expect(text).not.toContain('20–35%');
    const budget = await handleCreateBudgetBuild(context, 'fixture');
    expect(budget.content[0].text).toContain('Main Skill: Vortex');
  });

  it('does not count a disabled support as active or invent penetration gains', async () => {
    const client = { getBuildInfo: async () => ({ name: 'saved' }), getSkills: async () => ({ mainSocketGroup: 1, groups: [
      { index: 1, enabled: true, gems: [ { name: 'Vortex', enabled: true, isSupport: false },
        { name: 'Controlled Destruction', enabled: false, isSupport: true } ] },
    ] }), getTree: async () => ({ classId: 3 }), getStats: async () => ({ Life: 100 }) };
    const context = { pobDirectory: '/unused', ensureLuaClient: async () => {}, getLuaClient: () => client,
      buildService: {} } as unknown as Parameters<typeof handleOptimizeSkillLinks>[0];
    const text = (await handleOptimizeSkillLinks(context, 'saved')).content[0].text;
    expect(text).toContain('已启用宝石数: 1');
    expect(text).toContain('Controlled Destruction（已禁用）');
    expect(text).not.toContain('20–35%');
    expect(text).not.toContain('Penetration: no');
  });

  it('reports gem facts without fabricating corruption odds or ignored build names', async () => {
    const client = { getBuildInfo: async () => ({ name: 'current' }), getSkills: async () => ({ mainSocketGroup: 1,
      groups: [{ index: 1, enabled: true, gems: [
        { name: 'Vortex', level: 20, quality: 20, isSupport: false, enabled: true },
        { name: 'Efficacy', level: 10, quality: 0, isSupport: true, enabled: false },
      ] }] }) };
    const context = { pobDirectory: '/path/that/does/not/exist', ensureLuaClient: async () => {}, getLuaClient: () => client,
      buildService: {}, skillGemService: {} } as unknown as Parameters<typeof handleGemUpgradePath>[0];
    const text = (await handleGemUpgradePath(context, { build_name: 'current', budget: 'endgame' })).content[0].text;
    expect(text).toContain('Vortex');
    expect(text).not.toContain('Efficacy');
    expect(text).not.toContain('25% chance');
    expect(text).toContain('不计算升级收益、价格或腐化概率');
    await expect(handleGemUpgradePath(context, { build_name: 'other' })).rejects.toThrow('not found');
  });

  it('uses the saved main-skill group rather than assuming the first', async () => {
    const build = { Build: { className: 'Witch', mainSocketGroup: '2' }, Skills: { SkillSet: { id: '1', Skill: [
      { label: 'First', Gem: { name: 'Fireball', level: '1', quality: '0' } },
      { label: 'Second', Gem: { name: 'Vortex', level: '1', quality: '0' } },
    ] } } };
    const context = { pobDirectory: '', ensureLuaClient: async () => { throw new Error('offline'); }, getLuaClient: () => null,
      buildService: { readBuild: async () => build } } as unknown as Parameters<typeof handleOptimizeSkillLinks>[0];
    const text = (await handleOptimizeSkillLinks(context, 'saved')).content[0].text;
    expect(text).toContain('Group 2 (MAIN)');
    expect(text).not.toContain('Group 1 (MAIN)');
  });
});
