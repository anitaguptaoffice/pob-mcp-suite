# PoB MCP 插件

本目录包含 Codex 插件、Skill、客户端配置及启动脚本。项目整体介绍和本地构建方式见[仓库首页](../../README.md)。

## 运行方式

插件通过 Docker 启动 MCP 服务：

```bash
pob-docker-mcp/scripts/pob-mcp-docker.sh
```

默认镜像为 `ghcr.io/anitaguptaoffice/pob-mcp-suite:latest`。可通过 `POB_DOCKER_IMAGE` 指定镜像标签；本地开发镜像请使用仓库根目录的 Dockerfile。插件的 Skill 和 `references/` 是面向 AI 客户端的英文操作参考，用户交互使用简体中文。

## 验证插件

以下命令在 `packages/pob-mcp-market` 目录执行：

```bash
python3 scripts/validate_market.py
bash -n pob-docker-mcp/scripts/pob-mcp-docker.sh
bash -n pob-docker-mcp/scripts/smoke-test.sh
```

`smoke-test.sh` 需要 Docker，用于验证镜像能否响应 MCP 请求。
