# PoB MCP Suite

本仓库为简体中文社区提供 Path of Building（PoB）MCP 工具，让支持 MCP 的 AI 客户端读取和分析流放之路 1 的构筑，并用 PoB 引擎计算修改前后的属性。计算结果取决于构筑使用的 PoB 版本、技能和敌人配置，请先核对这些设置。

## 仓库内容

| 路径 | 内容 |
| --- | --- |
| `vendor/PathOfBuilding` | 保持原样的 PoB 引擎源码。 |
| `packages/pob-mcp` | MCP 服务、PoB 适配层、快照存储和测试。 |
| `packages/pob-mcp-market` | 客户端插件、Skill、配置及启动脚本。 |

PoB 引擎和 MCP 适配层分别维护。本仓库保留军团珠宝种子搜索、特殊升华名称和交易查询等定制；对照版本、改动与测试范围见[相对上游 MCP 的改动记录](UPSTREAM_MCP_CHANGES.md)。详细工具、配置和开发说明见 [MCP 说明](packages/pob-mcp/README.md)，插件和客户端入口见[插件说明](packages/pob-mcp-market/README.md)。

## 工作方式

服务只有一个工具面：每个构筑状态保存为不可变快照，修改生成子快照，计算在独立、短生命周期的无界面 PoB 进程中完成。快照保存构筑 XML 和创建来源；每次计算返回实际使用的引擎、配置和限制，比较时双方重新计算。PoB、poe.ninja 和官方国际服交易分别作为独立数据源接入。

- 缺失的属性保持 `unknown`，不会被写成 0。
- poe.ninja 价格是带赛季和时间戳的参考价，不是可成交价格。
- 交易搜索默认使用 `securable` 和明确标价，区分一口价、要价和未知。
- 启发式建议标注为未验证；有界采样说明上限。

设计取舍见[架构说明](docs/ARCHITECTURE.md)、[架构决策](docs/ARCHITECTURE_DECISIONS.md)和[中文摘要](docs/ARCHITECTURE.zh-CN.md)，各项能力和测试见[功能验收矩阵](docs/FEATURE_ACCEPTANCE.md)。

## 快速开始

需要 Node.js 20 或更高版本，以及能解析所用 PoB 版本的 LuaJIT。本机直接安装还需要 Python、make 和 C++ 编译器来构建原生文件锁依赖；Docker 镜像已包含所需环境。

```bash
npm --prefix packages/pob-mcp ci
npm --prefix packages/pob-mcp run build
```

在 MCP 客户端中注册 `packages/pob-mcp/build/index.js`，至少设置 `POB_DIRECTORY`（你的 PoB `Builds` 目录）和 `POB_CMD`（LuaJIT 路径）。完整变量表、首次调用流程和排障见 [MCP 说明](packages/pob-mcp/README.md)与[快速开始](packages/pob-mcp/docs/QUICKSTART.md)。

设置 `POE_TRADE_ENABLED=true` 后启用官方国际服交易工具；需要登录的查询还要设置 `POE_SESSION_ID`。

## 本地验证

以下命令在仓库根目录执行：

```bash
npm --prefix packages/pob-mcp ci
npm run validate
docker build -t pob-mcp-suite:local .
docker run --rm --entrypoint node pob-mcp-suite:local /opt/pob-mcp/scripts/engine-regression.mjs
```

`npm run validate` 依次执行构建、全量 Jest、插件元数据校验和 shell 语法检查。真实引擎行为由 `packages/pob-mcp/tests/smoke/` 覆盖，最后一条命令检查固定数值基线。通过测试不能保证所有构筑、游戏机制或交易结果均正确。

## 发布与同步

- Docker 镜像从仓库中的 PoB 源码和 MCP 服务构建；插件默认使用 `ghcr.io/anitaguptaoffice/pob-mcp-suite:latest`。
- `.github/workflows/sync-pob.yml` 每周一同步 Path of Building Community 的 `dev` 分支，检查军团珠宝数据并运行引擎测试。冲突或兼容问题需要人工处理。
- 该流程同步 PoB 引擎，**不会自动同步 MCP 上游代码**。
