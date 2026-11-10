import { describe, expect, it } from '@jest/globals';
import { XMLParser } from 'fast-xml-parser';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { handleAnalyzeSkillLinks, handleFindOptimalLinks, handleSuggestSupportGems, handleValidateGemQuality } from '../../src/handlers/skillGemHandlers.js';

const xml = readFileSync(path.resolve('tests/fixtures/occ-vortex.xml'), 'utf8');
const build = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '' }).parse(xml).PathOfBuilding;
const context = { buildService: { readBuild: async () => build } } as unknown as Parameters<typeof handleAnalyzeSkillLinks>[0];

describe('skill gem tools avoid invented figures', () => {
  it('reads the selected main group from a real old-format PoB file', async () => {
    const result = await handleAnalyzeSkillLinks(context, { build_name: 'fixture' });
    expect(result.content[0].text).toContain('技能组 5');
    expect(result.content[0].text).toContain('Vortex');
    expect(result.content[0].text).toContain('Controlled Destruction');
  });
  it('reports PoB compatibility candidates without claiming gains or prices', async () => {
    const client = { getBuildInfo: async () => ({ name: 'fixture' }), getCompatibleSupports: async () => ({
      groupIndex: 5, skillName: 'Vortex', candidates: [{ id: 'id', name: 'Efficacy', exceptional: false, alreadySocketed: true }], total: 1, failed: 0,
    }) };
    const liveContext = { ...context, pobDirectory: '/unused', getLuaClient: () => client, ensureLuaClient: async () => {} } as unknown as Parameters<typeof handleSuggestSupportGems>[0];
    const result = await handleSuggestSupportGems(liveContext, { build_name: 'fixture', budget: 'endgame' });
    const report = JSON.parse(result.content[0].text);
    expect(report.candidates[0].name).toBe('Efficacy');
    expect(report.warnings.join(' ')).toContain('未用于筛选');
    expect(result.content[0].text).not.toMatch(/Est\. DPS|Bang-for-Buck|Total Est\.|🏆/);
  });
  it('does not claim an unmeasured setup is optimal', async () => {
    const result = await handleFindOptimalLinks(context, { build_name: 'fixture', link_count: 6 });
    expect(result.content[0].text).not.toMatch(/Est\. DPS|Bang-for-Buck|Total Est\.|🏆/);
    expect(result.content[0].text).toContain('compare_gem_setups');
  });
  it('does not present a corrupted or missing quality as a proven upgrade', async () => {
    const result = await handleValidateGemQuality(context, { build_name: 'fixture', include_corrupted: true });
    expect(result.content[0].text).toContain('不推断腐化概率');
    expect(result.content[0].text).not.toContain('fully optimized');
    expect(result.content[0].text).not.toContain('8-12%');
  });
});
