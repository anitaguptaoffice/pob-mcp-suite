# PoB MCP 插件

本目录包含 Codex 插件、Skill、客户端配置及启动脚本。项目整体介绍和本地构建方式见[仓库首页](../../README.md)。

## 运行方式

插件通过 Docker 启动 MCP 服务：

```bash
pob-docker-mcp/scripts/pob-mcp-docker.sh
```

默认镜像为 `ghcr.io/anitaguptaoffice/pob-mcp-suite:latest`。可通过 `POB_DOCKER_IMAGE` 指定镜像标签；本地开发镜像请使用仓库根目录的 Dockerfile。插件的 Skill 和 `references/` 是面向 AI 客户端的英文操作参考，用户交互使用简体中文。

## 技能分工

| 技能 | 负责什么 | 可以直接这样问 |
| --- | --- | --- |
| `pob-docker-mcp` | 连接、排障、导入导出和直接查看或修改构筑 | “读取我的构筑，看看当前主技能和配置。” |
| `pob-build-review` | 诊断现有 BD，确认伤害和生存问题，试算并安排改进优先级 | “这个 BD 为什么容易死？先找能验证的问题。” |
| `pob-gear-upgrade` | 确认替换目标、筛选装备、用 PoB 对比单件或整组收益 | “按我的国际服赛季和预算找装备，比较收益和损失。” |
| `pob-economy` | 行情参考、挂牌估价、交易过滤、预算和价格证据 | “这件装备大概值多少？只看能去藏身处购买的一口价。” |
| `pob-crafting` | 制作数据、规则假设、有限模拟与制作预算 | “这个底子还有什么制作空间？哪些概率可以确认？” |

技能在客户端组织工作流，通过已声明的 MCP 工具调用独立功能模块。PoB
计算、交易查询、候选比较、预算计算和校验继续由服务端负责；技能只解释
结果，不维护另一套伤害、价格或推荐算法。同一份技能包供不同客户端使用。

插件通过 `skills/` 自动发现这些入口。直接使用技能时也可指定名称，例如
“使用 `pob-build-review` 检查这份构筑”。技能可见不代表 MCP 已连接；应先
检查当前客户端实际发现的工具。完整制作模拟和全局最优配装不在当前能力内。

## 验证插件

以下命令在 `packages/pob-mcp-market` 目录执行：

```bash
python3 scripts/validate_market.py
bash -n pob-docker-mcp/scripts/pob-mcp-docker.sh
bash -n pob-docker-mcp/scripts/smoke-test.sh
```

`smoke-test.sh` 需要 Docker，用于验证镜像能否响应 MCP 请求。
