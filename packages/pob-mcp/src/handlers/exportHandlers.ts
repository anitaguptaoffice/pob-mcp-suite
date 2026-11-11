import type { BuildService } from "../services/buildService.js";
import { noteIgnoredError } from '../utils/errorHandling.js';
import type { BuildExportService } from "../services/buildExportService.js";
import { toFiniteNumber, type BuildInfo, type PoBLuaApiClient, type SkillsOutput, type StatsExport, type TreeState, type ConfigValues } from "../adapters/pob/bridge.js";
import type { ExportContext } from "../utils/contextBuilder.js";
import { wrapHandler } from "../utils/errorHandling.js";

interface ExportHandlerContext {
  buildService: BuildService;
  exportService: BuildExportService;
  luaClient?: PoBLuaApiClient;
}

export async function handleExportBuild(
  context: ExportHandlerContext,
  args: {
    build_name: string;
    output_name: string;
    output_directory?: string;
    overwrite?: boolean;
    notes?: string;
  }
) {
  return wrapHandler('export build', async () => {
  const { exportService, buildService } = context;

  // Read the source build
  const buildData = await buildService.readBuild(args.build_name);

  // Export the build
  const result = await exportService.exportBuild(buildData, {
    outputName: args.output_name,
    outputDirectory: args.output_directory,
    overwrite: args.overwrite,
    notes: args.notes,
  }, await buildService.readBuildXml(args.build_name));

  // Generate brief summary (not full build details to keep response small)
  const className = buildData.Build?.className || "Unknown";
  const ascendancy = buildData.Build?.ascendClassName || "None";
  const level = buildData.Build?.level || "Unknown";

  return {
    content: [
      {
        type: "text" as const,
        text:
          `${result.message}\n\n` +
          `Exported: ${className} (${ascendancy}) - Level ${level}\n` +
          `Source: ${args.build_name}\n` +
          `Output: ${args.output_name}`,
      },
    ],
  };
  });
}

export async function handleSaveTree(
  context: ExportHandlerContext,
  args: {
    build_name: string;
    nodes: string[];
    mastery_effects?: Record<string, number>;
    backup?: boolean;
  }
) {
  return wrapHandler('save tree', async () => {
  const { exportService, buildService } = context;

  const result = await exportService.saveTree({
    buildName: args.build_name,
    nodes: args.nodes,
    masteryEffects: args.mastery_effects,
    backup: args.backup,
  });

  let message = result.message;
  if (result.backupPath) {
    message += `\n\nBackup created: ${result.backupPath}`;
  }

  // Invalidate cache for this build
  buildService.invalidateBuild(args.build_name);

  return {
    content: [
      {
        type: "text" as const,
        text: message,
      },
    ],
  };
  });
}

export async function handleSnapshotBuild(
  context: ExportHandlerContext,
  args: {
    build_name: string;
    description?: string;
    tag?: string;
  }
) {
  return wrapHandler('snapshot build', async () => {
  const { exportService } = context;

  const result = await exportService.snapshotBuild({
    buildName: args.build_name,
    description: args.description,
    tag: args.tag,
  });

  return {
    content: [
      {
        type: "text" as const,
        text:
          `Snapshot created successfully!\n\n` +
          `Snapshot ID: ${result.snapshotId}\n` +
          `Tag: ${args.tag || 'snapshot'}\n` +
          `Location: ${result.snapshotPath}\n\n` +
          `You can restore this snapshot later using:\n` +
          `  restore_snapshot(build_name="${args.build_name}", snapshot_id="${result.snapshotId}")`,
      },
    ],
  };
  });
}

export async function handleListSnapshots(
  context: ExportHandlerContext,
  args: {
    build_name: string;
    limit?: number;
    tag_filter?: string;
  }
) {
  return wrapHandler('list snapshots', async () => {
  const { exportService } = context;

  const result = await exportService.listSnapshots(args.build_name, {
    limit: args.limit,
    tagFilter: args.tag_filter,
  });

  const formatted = exportService.formatSnapshotList(result);

  return {
    content: [
      {
        type: "text" as const,
        text: `=== Snapshots for ${args.build_name} ===\n\n${formatted}`,
      },
    ],
  };
  });
}

export async function handleRestoreSnapshot(
  context: ExportHandlerContext,
  args: {
    build_name: string;
    snapshot_id: string;
    backup_current?: boolean;
  }
) {
  return wrapHandler('restore snapshot', async () => {
  const { exportService, buildService } = context;

  const result = await exportService.restoreSnapshot({
    buildName: args.build_name,
    snapshotId: args.snapshot_id,
    backupCurrent: args.backup_current,
  });

  let message = result.message;
  if (result.backupId) {
    message += `\n\nCurrent build backed up with ID: ${result.backupId}`;
  }

  // Invalidate cache for this build
  buildService.invalidateBuild(args.build_name);

  let reloadFailed = false;
  if (context.luaClient) {
    const buildPath = buildService.resolveBuildPath(args.build_name);
    if (context.luaClient.getLoadedFilePath() === buildPath) {
      try {
        await context.luaClient.loadBuildXml(result.restoredXml, args.build_name.replace(/\.xml$/i, ''), buildPath);
        message += '\n\nLive PoB build reloaded from the restored snapshot.';
      } catch (error) {
        reloadFailed = true;
        message += `\n\nThe file was restored, but the live reload FAILED: ${error instanceof Error ? error.message : String(error)}. Reload this build before using live stats.`;
      }
    } else {
      message += '\n\nThe live build has a different or unknown source and was left unchanged. Use lua_load_build to analyze the restored file.';
    }
  }

  return {
    isError: reloadFailed,
    content: [
      {
        type: "text" as const,
        text: message,
      },
    ],
  };
  });
}

export async function handleExportBuildSummary(context: ExportContext) {
  return wrapHandler('export build summary', async () => {
    const luaClient = context.luaClient;
    if (!luaClient) throw new Error('Lua bridge not active. Use lua_load_build first.');

    // The bridge processes one request at a time. Keep failures visible and do
    // not turn missing values into zeroes or missing sections into empty ones.
    const unavailable: string[] = [];
    async function read<T>(label: string, action: () => Promise<T>): Promise<T | undefined> {
      try {
        const value = await action();
        if (value == null) throw new Error('No data returned');
        return value;
      } catch (error) {
        noteIgnoredError(`build summary: ${label}`, error);
        unavailable.push(label);
        return undefined;
      }
    }
    const fields = [
      'Life', 'EnergyShield', 'Mana', 'ManaUnreserved', 'TotalDPS', 'CombinedDPS',
      'MinionTotalDPS', 'MinionCombinedDPS', 'FireResist', 'ColdResist', 'LightningResist', 'ChaosResist',
      'Armour', 'Evasion', 'TotalEHP', 'LifeRegen', 'SpellSuppressionChance', 'BlockChance',
    ];
    const info: BuildInfo | undefined = await read('角色信息', () => luaClient.getBuildInfo());
    const stats: StatsExport | undefined = await read('计算属性', () => luaClient.getStats(fields));
    const skills: SkillsOutput | undefined = await read('技能组', () => luaClient.getSkills());
    const tree: TreeState | undefined = await read('天赋树', () => luaClient.getTree());
    const items = await read('装备', () => luaClient.getItems());
    const config: ConfigValues | undefined = await read('计算配置', () => luaClient.getConfig());

    const escape = (v: unknown) => String(v).replace(/\|/g, '\\|').replace(/[\r\n]+/g, ' ');
    const display = (v: unknown) => v === undefined || v === null || v === '' ? '未提供' : escape(v);
    const value = (key: string, suffix = '') => {
      const n = toFiniteNumber(stats?.[key]);
      return n === undefined ? '未提供' : `${n.toLocaleString('en-US', { maximumFractionDigits: 2 })}${suffix}`;
    };
    const lines: string[] = [
      `# ${display(info?.name ?? '未命名构筑')}`, '',
      '> 数据来自当前加载的 PoB 引擎状态。伤害和防御取决于技能、装备及计算配置；原始名称和配置键保留以便核对。', '',
      `- 职业：${display(tree?.className ?? info?.className)}`,
      `- 升华：${display(tree?.ascendClassName ?? info?.ascendClassName)}`,
      `- 第二升华：${display(tree?.secondaryAscendClassName)}`,
      `- 等级：${display(info?.level)}`,
      `- 天赋树版本：${display(tree?.treeVersion ?? info?.treeVersion)}`, '',
      '## 计算属性', '', '| 属性 | 数值 |', '| --- | ---: |',
    ];
    const rows: Array<[string, string, string?]> = [
      ['生命', 'Life'], ['能量护盾', 'EnergyShield'], ['魔力', 'Mana'], ['未保留魔力', 'ManaUnreserved'],
      ['TotalDPS', 'TotalDPS'], ['CombinedDPS', 'CombinedDPS'], ['MinionTotalDPS', 'MinionTotalDPS'], ['MinionCombinedDPS', 'MinionCombinedDPS'],
      ['有效生命（TotalEHP）', 'TotalEHP'], ['火焰抗性', 'FireResist', '%'], ['冰霜抗性', 'ColdResist', '%'],
      ['闪电抗性', 'LightningResist', '%'], ['混沌抗性', 'ChaosResist', '%'], ['护甲', 'Armour'],
      ['闪避值', 'Evasion'], ['格挡率', 'BlockChance', '%'], ['法术压制几率', 'SpellSuppressionChance', '%'],
      ['生命再生', 'LifeRegen'],
    ];
    for (const [label, key, suffix] of rows) lines.push(`| ${label} | ${value(key, suffix)} |`);
    lines.push('', '伤害字段分别保留 PoB 的原始名称，不能直接相加；中毒、召唤物数量及其他机制是否计入，取决于构筑和 PoB 的计算方式。', '');

    lines.push('## 技能组', '');
    if (!skills) lines.push('未取得技能数据。');
    else if (!skills.groups?.length) lines.push('没有技能组。');
    else for (const group of skills.groups) {
      const flags = [group.index === skills.mainSocketGroup ? '主技能组' : '', group.enabled === false ? '已禁用' : '已启用', group.includeInFullDPS ? '计入 FullDPS' : ''].filter(Boolean);
      lines.push(`### ${display(group.label || `技能组 ${group.index}`)}（${flags.join('，')}）`, '', `- 插槽：${display(group.slot)}`);
      if (group.gems?.length) for (const gem of group.gems) {
        lines.push(`- ${display(gem.name)}：等级 ${display(gem.level)}，品质 ${display(gem.quality)}%，${gem.isSupport ? '辅助宝石' : '非辅助宝石'}${gem.enabled === false ? '，已禁用' : ''}`);
      } else lines.push('- 未提供宝石详情。');
      lines.push('');
    }
    lines.push('', '## 装备', '');
    if (!items) lines.push('未取得装备数据。');
    else {
      const equipped = items.filter(item => item.id > 0);
      if (!equipped.length) lines.push('没有已装备的物品。');
      for (const item of equipped) {
        lines.push(`### ${display(item.slot)}：${display(item.name || item.baseName)}`, '');
        if (item.shown === false) lines.push('此槽位当前未显示，可能属于备用配置。', '');
        if (item.active !== undefined) lines.push(`状态：${item.active ? '已启用' : '未启用'}`, '');
        if (item.raw) lines.push('物品原文：', '', ...item.raw.split(/\r?\n/).map(line => `    ${line}`), '');
        else lines.push('未提供物品原文。', '');
      }
    }
    lines.push('', '## 天赋树', '');
    if (!tree) lines.push('未取得天赋树数据。');
    else {
      lines.push(`- 已分配节点数量：${tree.nodes?.length ?? '未提供'}`);
      if (tree.masteryEffects) {
        const masteries = Object.entries(tree.masteryEffects);
        lines.push(`- 专精选择：${masteries.length} 项${masteries.length ? `（节点 ID → 效果 ID：${masteries.map(([node, effect]) => `${escape(node)} → ${escape(effect)}`).join('，')}）` : ''}`);
      } else lines.push('- 专精选择：未提供');
      if (tree.nodes?.length) {
        const names = await read('天赋名称解析', async () => {
          const data = await context.treeService.getTreeData(tree.treeVersion);
          if (tree.treeVersion && data.version && data.version !== tree.treeVersion) {
            throw new Error(`Tree version mismatch: requested ${tree.treeVersion}, received ${data.version}`);
          }
          const result = await context.treeService.mapNodesToDetails(tree.nodes.map(String), data);
          return result;
        });
        if (names) {
          const keystones = names.nodes.filter(n => n.isKeystone).map(n => n.name || `Node ${n.skill}`);
          lines.push(`- 已解析关键天赋：${keystones.length ? keystones.map(display).join('、') : names.invalidIds?.length ? '未解析到' : '无'}`);
          if (names.invalidIds?.length) lines.push(`- 无法解析 ${names.invalidIds.length} 个节点，关键天赋列表可能不完整。`);
        }
      } else if (tree.nodes) lines.push('- 已分配关键天赋：无');
    }
    lines.push('', '## 计算配置（PoB 原始键和值）', '');
    if (!config) lines.push('未取得计算配置。');
    else {
      const entries = Object.entries(config).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b));
      if (!entries.length) lines.push('未提供配置项。');
      else {
        lines.push('| 配置键 | 值 |', '| --- | --- |');
        for (const [key, entry] of entries) lines.push(`| ${escape(key)} | ${escape(entry)} |`);
      }
    }
    if (unavailable.length) lines.push('', '## 未取得的数据', '', ...unavailable.map(label => `- ${label}`));
    lines.push('', '---', '生成工具：pob-mcp-server');
    return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
  });
}
