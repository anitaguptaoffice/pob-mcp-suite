# PoB MCP Suite

本仓库为简体中文社区提供 Path of Building（PoB）MCP 工具，让支持 MCP 的 AI 客户端读取和分析流放之路构筑，并使用 PoB 引擎计算修改前后的属性。建议先核对构筑使用的 PoB 版本、技能和敌人配置：计算结果取决于这些设置。

## 仓库内容

| 路径 | 内容 |
| --- | --- |
| `vendor/PathOfBuilding` | 保持原样的 PoB 引擎源码。 |
| `packages/pob-mcp` | MCP 服务、PoB 适配层和测试。 |
| `packages/pob-mcp-market` | 客户端插件、Skill、配置及启动脚本。 |

PoB 引擎和 MCP 适配层分别维护。本仓库保留军团珠宝种子搜索、特殊升华名称和交易查询等定制；对照版本、改动与测试范围见[相对上游 MCP 的改动记录](UPSTREAM_MCP_CHANGES.md)。详细 MCP 工具与开发参考见 [MCP 说明](packages/pob-mcp/README.md)，插件和客户端入口见[插件说明](packages/pob-mcp-market/README.md)。

造价功能和操作指引独立维护。`estimate_build_cost` 按国际服指定赛季查询 poe.ninja 公开行情，列出暗金和宝石参考价及无法估价的项目；稀有装备尚未自动估价，参考小计不是整套造价。`pob-economy` Skill 负责引导 AI 使用造价、交易与制作工具。

在 MCP 服务环境中设置 `POE_TRADE_ENABLED=true` 并重启服务后，`estimate_comparable_item` 可按明确给出的底材和词缀条件对比稀有装备挂牌。`compare_craft_budget` 使用外部已核实的单次成功率和单次成本比较预算；它不推断游戏概率，也不是制作模拟器。制作操作另由 `pob-crafting` Skill 提供指导。

`compare_equipment_candidate` 接收完整物品文本和当前装备部位，使用 PoB 引擎预览换装前后的伤害与防御，不会实际装备物品，也不会自动提高候选物品的品质。结果会列出原装备和候选装备上 PoB 标记为未解析的生效词缀；这不能证明整套构筑或所有特殊机制均被正确识别。结果依赖当前技能和配置，珠宝、药剂和备用武器栏暂不支持；物品是否合法、能否买到以及价格仍需另行核对。

启用交易接口后，`compare_trade_listing_in_pob` 可以读取指定国际服挂牌的官方物品复制文本，交给同一 PoB 预览功能；`compare_trade_listings_in_pob` 支持对同一搜索中的最多五件挂牌逐一预览。每件结果及失败原因单独列出，不自动排名或换算通货。挂牌可能失效或来自缓存，且单凭价格不能判断是否是一口价；请从使用 `securable` 筛选的搜索结果选取候选。

`compare_gem_setups` 可以用隔离的 PoB 引擎比较已保存主技能组中的明确候选方案，分别返回角色和召唤物的伤害指标，并标注 PoB 能确认的辅助宝石生效状态。每套方案都要包含原有主动宝石；新辅助宝石默认按 20 级、0% 品质计算，也可为方案指定等级和品质；仍需核对宝石是否可获得、孔数、辅助效果和构筑配置。`suggest_support_gems` 根据 PoB 原版兼容性筛选候选，按名称排列，不表示伤害收益或可买到。 `rank_support_gems` 可以对指定的 1–4 个替换候选逐个用 PoB 实测排序，并排除未生效的辅助宝石；它不会搜索全部宝石或估算价格。当前不自动搜索最优宝石或估算价格。

`simulate_simple_annul` 仅枚举普通物品使用一次剥离石的结果，要求事先确认完整外显词缀清单且不存在保护、分裂、催化剂等特殊规则；不能用于自动识别物品或模拟完整工艺。

## 本地验证

以下命令在仓库根目录执行，需要 Node.js、npm 和 Docker：

```bash
npm --prefix packages/pob-mcp ci
npm run validate
docker build -t pob-mcp-suite:local .
docker run --rm --entrypoint node -e POB_LUA_ENABLED=true -e POE_TRADE_ENABLED=false pob-mcp-suite:local /opt/pob-mcp/scripts/mcp-smoke.mjs node /opt/pob-mcp/build/index.js
docker run --rm --entrypoint node pob-mcp-suite:local /opt/pob-mcp/scripts/engine-regression.mjs
```

最后两条分别检查 MCP 服务与实际 PoB 引擎的代表性计算。通过测试不能保证所有构筑、游戏机制或交易结果均正确。

## 发布与同步

- Docker 镜像从仓库中的 PoB 源码和 MCP 服务构建；插件默认使用 `ghcr.io/anitaguptaoffice/pob-mcp-suite:latest`。
- `.github/workflows/sync-pob.yml` 每周一同步 Path of Building Community 的 `dev` 分支，检查军团珠宝数据并运行引擎测试。冲突或兼容问题需要人工处理。
- 该流程同步 PoB 引擎，**不会自动同步 MCP 上游代码**。旧的独立仓库仅作为历史参考。
