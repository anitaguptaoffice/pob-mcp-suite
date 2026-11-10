# 相对上游 MCP 的改动记录

本文记录本仓库相对 [ianderse/pob-mcp](https://github.com/ianderse/pob-mcp) 的主要差异，供维护和后续同步时参考；它不是逐行变更清单。这里的状态对应集成分支，不代表这些改动已经合并到本仓库的默认分支或发布镜像。

## 对照基准

- 原分支共同祖先：`7ecd92e52b28b1582e576b7500d0784eafd5f787`。
- 本次集成的上游 MCP：[`67c3404fc6062bcfe3f690073ec25fd0daa454de`](https://github.com/ianderse/pob-mcp/commit/67c3404fc6062bcfe3f690073ec25fd0daa454de)。下文“上游”指这个版本，不表示以后版本的状态。
- 配套 PoB 引擎：[PathOfBuildingCommunity/PathOfBuilding `a69391d6daaaea1aaf8054668a094aad88dd7eaa`](https://github.com/PathOfBuildingCommunity/PathOfBuilding/commit/a69391d6daaaea1aaf8054668a094aad88dd7eaa)，版本 2.67.2，包含 `3_29` 天赋树；该引擎不包含 `3_30` 天赋树。
- 集成工作见本仓库 [PR #8](https://github.com/anitaguptaoffice/pob-mcp-suite/pull/8)。历史交易功能见 [PR #4](https://github.com/anitaguptaoffice/pob-mcp-suite/pull/4)、[PR #5](https://github.com/anitaguptaoffice/pob-mcp-suite/pull/5)，军团珠宝功能见 [PR #6](https://github.com/anitaguptaoffice/pob-mcp-suite/pull/6)。

PoB 引擎和 MCP 是两个不同的上游：`vendor/PathOfBuilding/src` 在上述引擎版本下与原版一致；本仓库的适配和功能放在 `packages/pob-mcp`，不依靠修改引擎源码。`.github/workflows/sync-pob.yml` 同步的是 PoB 引擎，而不是自动同步 MCP 代码。

## 保留的功能和修复

| 领域 | 本仓库的差异 | 主要位置 |
| --- | --- | --- |
| 军团珠宝 | `find_timeless_jewel_seeds` 在独立模块中调用 PoB 的 Elegant Hubris 数据，按插槽、目标天赋等条件搜索种子，并处理 Caspiro / Supreme Ostentation。功能模块与桥接层分开。上游已有的 zlib 解压修复不应算作本仓库独有功能。 | `packages/pob-mcp/lua/timeless_jewel.lua`、`src/handlers/timelessJewelHandlers.ts` |
| 职业、升华和天赋树 | 从当前天赋树数据读取职业、升华和第二升华名称，避免特殊天赋树被固定名称误判；在点数估算不可靠时避免错误告警。创建角色时使用当前树里的职业数据；切换树版本时清理旧升华状态，避免旧节点引发错误。特殊名称覆盖了替代天赋树，但不能仅凭这些提交确定其对应的赛季名称。 | `packages/pob-mcp/lua/pob_ops.lua`、`src/services/treeService.ts` |
| PoB 新版接口适配 | 适配当前引擎的物品构造、交易查询构造和查询结果格式；自定义词缀写入独立的 `MCP Custom Mods` 组，保留其他自定义组。这些适配针对上面固定的引擎版本，后续升级仍需验证。 | `packages/pob-mcp/lua/pob_ops.lua`、`lua/vanilla_stdio_bridge.lua` |
| 交易查询 | 保留按词缀来源区分和审计、多个 `stat_groups` 条件组、在线状态及稀有度筛选等能力，并处理官方词缀数据与查询值格式。 | `packages/pob-mcp/src/handlers/tradeHandlers.ts`、`src/services/tradeQueryBuilder.ts`、`src/services/tradeClient.ts` |
| 旧接口兼容 | 保留旧版工具声明；测试基于旧工具名称清单检查接口声明。声明存在不等于所有参数组合和游戏机制都经过功能验证。Docker 启动脚本仅在环境变量已设置时传递 `POE_SESSION_ID`。 | `packages/pob-mcp/tests/unit/legacyToolCompatibility.test.ts`、`tests/fixtures/legacy-tool-names.json`、`packages/pob-mcp-market/pob-docker-mcp/scripts/pob-mcp-docker.sh` |
| 运行时 | Docker 使用与 PoB SimpleGraphic 对应的固定 LuaJIT 版本，仓库自己的 Lua 辅助模块放在适配层目录内。这样可以运行当前 PoB 所需的 Lua 语法，同时保持引擎源码原样。 | `Dockerfile`、`packages/pob-mcp/lua/` |

表内省略前缀的 `src/`、`lua/` 和 `tests/` 路径均相对于 `packages/pob-mcp/`。

## 已从上游引入的能力

本次集成也包含上游已有的功能和修复，例如 `lua_import_code`、安全保存、伤害及召唤物计算输出、天赋专精保留、配置校验和制作相关能力。这些不应全部归功于本仓库；本仓库另外维护适配代码和回归测试，以验证它们与当前 PoB 引擎及旧接口一起工作。

## 验证记录与边界

- 集成时的完整自动测试结果为 495 项通过、13 项跳过；另有真实引擎回归和 Docker 离线冒烟测试。测试命令见 [README](README.md#local-validation)。
- `packages/pob-mcp/scripts/engine-regression.mjs` 固定检查普通技能伤害、召唤物伤害、珠宝种子、常规和替代天赋树等代表性场景。固定数值来自指定 PoB 版本，更新引擎后应核实差异原因，再决定是否更新预期值。
- 同一引擎与同一个已有角色样本下，新旧适配层对天赋节点、职业、生命、护盾、伤害和有效生命等结果做过对照。此前旧接口有伤害字段缺失、召唤物输出结构及创建职业错误等问题；这个对照是无界面引擎之间的比较，不等于与桌面 PoB 或游戏内所有情况逐项核对。
- 交易接口做过公开只读查询冒烟测试；需要登录态的加权搜索没有做真实在线验证。部分测试被跳过，包括缺少可用样本的天赋专精冒烟场景，因此不能据此认定所有构筑都完全准确。
- 历史 PR 中还记录了当时的针对性测试和珠宝查询对照；它们与本次完整测试不是同一批测试，不能简单相加。

## 以后同步时

先记录新的 MCP 和 PoB 提交号，并分别比较两者的更新。合入 MCP 代码时保留上表中的独立模块、兼容接口和测试；若上游已经覆盖某项修复，先用相同输入和引擎版本对照结果，再决定是否删除本地实现。更新 PoB 后运行 README 中的验证和真实引擎回归，检查固定数值、珠宝数据、特殊天赋树与旧工具声明；不要把 PoB 自动同步等同于 MCP 自动同步。
