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
