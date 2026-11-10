/**
 * Skill Link Optimization and Analysis
 *
 * Analyzes skill gem setups and suggests improvements for optimal damage/utility.
 */

interface SkillGem {
  name: string;
  level?: number;
  quality?: number;
  qualityType?: string;
  enabled?: boolean;
  isSupport?: boolean;
  appliedToSelectedSkill?: boolean;
}

export interface SkillGroup {
  index: number;
  label?: string;
  slot?: string;
  enabled: boolean;
  isMainSkill: boolean;
  gems: SkillGem[];
  includeInFullDPS?: boolean;
}

interface SkillLinkIssue {
  type: 'missing_link' | 'suboptimal_gem' | 'low_level' | 'no_quality' | 'link_order' | 'wrong_support' | 'no_more_multiplier' | 'no_penetration';
  severity: 'high' | 'medium' | 'low';
  message: string;
  suggestion: string;
}

interface SkillGroupAnalysis {
  group: SkillGroup;
  isValid: boolean;
  linkCount: number;
  issues: SkillLinkIssue[];
  suggestions: string[];
  expectedDamageBoost?: string;
}

interface SkillOptimizationResult {
  summary: string;
  buildType: string;
  groupAnalyses: SkillGroupAnalysis[];
  generalSuggestions: string[];
}

/** Use the engine's explicit gem classification when available. */
function isSupportGem(gem: SkillGem): boolean | undefined {
  if (gem.isSupport !== undefined) return gem.isSupport;
  return gem.name.toLowerCase().includes('support') ? true : undefined;
}

/** Report observable socket-group facts without asserting DPS or compatibility. */
function analyzeSkillGroup(group: SkillGroup): SkillGroupAnalysis {
  const enabledGems = group.gems.filter(gem => gem.enabled !== false);
  const activeGems = enabledGems.filter(gem => isSupportGem(gem) === false);
  const unknownGems = enabledGems.filter(gem => isSupportGem(gem) === undefined);
  const supports = enabledGems.filter(gem => isSupportGem(gem) === true);
  const analysis: SkillGroupAnalysis = {
    group, isValid: true, linkCount: enabledGems.length, issues: [], suggestions: [],
  };
  if (!group.enabled) {
    analysis.suggestions.push('该技能组已禁用，不能据此判断当前伤害。');
    return analysis;
  }
  if (enabledGems.length === 0) {
    analysis.isValid = false;
    analysis.issues.push({ type: 'missing_link', severity: 'medium', message: '技能组没有启用的宝石', suggestion: '检查技能组和宝石是否需要启用。' });
  } else if (activeGems.length === 0 && unknownGems.length === 0 && supports.length > 0) {
    analysis.isValid = false;
    analysis.issues.push({ type: 'wrong_support', severity: 'medium', message: '启用的宝石均标识为辅助宝石', suggestion: '确认该组是否需要主动技能。' });
  }
  if (unknownGems.length > 0) analysis.suggestions.push('部分宝石的主动或辅助类型未知，不能判断其连接关系。');
  if (activeGems.length > 1) analysis.suggestions.push('该组有多个主动技能；请以 PoB 中选中的技能为准。');
  if (supports.some(gem => gem.appliedToSelectedSkill === false)) analysis.suggestions.push('部分辅助宝石未作用于所选技能，请检查技能和连接。');
  if (supports.some(gem => gem.appliedToSelectedSkill === undefined)) analysis.suggestions.push('部分辅助宝石的生效状态未知；请在 PoB 中检查。');
  return analysis;
}

/**
 * Analyze all skill groups
 */
export function analyzeSkillSetup(
  groups: SkillGroup[],
  buildArchetype: string
): SkillOptimizationResult {
  const groupAnalyses: SkillGroupAnalysis[] = [];
  const generalSuggestions: string[] = [];

  for (const group of groups) {
    if (group.gems.length === 0 && !group.isMainSkill) {
      continue; // Skip empty non-main groups
    }
    const analysis = analyzeSkillGroup(group);
    groupAnalyses.push(analysis);
  }

  const mainSkill = groupAnalyses.find(g => g.group.isMainSkill);
  if (!mainSkill) generalSuggestions.push('未能确认主技能组，请在 PoB 中检查所选技能。');
  generalSuggestions.push('辅助生效状态仅在 PoB 提供所选技能效果时显示；此处不推断伤害收益。');

  const totalIssues = groupAnalyses.reduce((sum, g) => sum + g.issues.length, 0);

  return {
    summary: `Analyzed ${groupAnalyses.length} skill groups with ${totalIssues} issue${
      totalIssues !== 1 ? 's' : ''
    }`,
    buildType: buildArchetype,
    groupAnalyses,
    generalSuggestions,
  };
}

/**
 * Format skill optimization results
 */
export function formatSkillOptimization(result: SkillOptimizationResult): string {
  let output = '=== Skill Link Optimization ===\n\n';

  output += `Build Type: ${result.buildType}\n`;
  output += `${result.summary}\n\n`;

  // General suggestions
  if (result.generalSuggestions.length > 0) {
    output += '=== General Recommendations ===\n';
    for (const suggestion of result.generalSuggestions) {
      output += `${suggestion}\n`;
    }
    output += '\n';
  }

  // Analyze each group
  for (const analysis of result.groupAnalyses) {
    const group = analysis.group;
    output += `**Group ${group.index}${group.isMainSkill ? ' (MAIN)' : ''}**\n`;
    if (group.label) {
      output += `  Label: ${group.label}\n`;
    }
    output += `  已启用宝石数: ${analysis.linkCount}\n`;
    output += `  Gems: ${group.gems.map(g => `${g.name}${g.enabled === false ? '（已禁用）' : ''}${isSupportGem(g) === true ? `（辅助；${g.appliedToSelectedSkill === true ? '作用于所选技能' : g.appliedToSelectedSkill === false ? '未作用于所选技能' : '生效状态未知'}）` : isSupportGem(g) === false ? '（主动）' : '（类型未知）'}`).join(', ')}\n`;

    if (analysis.issues.length > 0) {
      output += `  Issues:\n`;
      for (const issue of analysis.issues) {
        const icon = issue.severity === 'high' ? '⚠️' : issue.severity === 'medium' ? '⚡' : 'ℹ️';
        output += `    ${icon} ${issue.message}\n`;
        output += `       → ${issue.suggestion}\n`;
      }
    }

    if (analysis.suggestions.length > 0) {
      output += `  Suggestions:\n`;
      for (const suggestion of analysis.suggestions) {
        output += `    → ${suggestion}\n`;
      }
    }

    output += '\n';
  }

  return output;
}
