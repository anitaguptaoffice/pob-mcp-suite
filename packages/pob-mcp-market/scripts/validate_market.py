#!/usr/bin/env python3
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def load_json(path: Path):
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def assert_file(path: Path):
    if not path.is_file():
        raise SystemExit(f"missing file: {path.relative_to(ROOT)}")


def main():
    marketplace = load_json(ROOT / "marketplace.json")
    codex_marketplace = load_json(ROOT / ".agents" / "plugins" / "marketplace.json")
    versions = load_json(ROOT / "versions.json")

    if marketplace != codex_marketplace:
        raise SystemExit("marketplace.json and .agents/plugins/marketplace.json must match")

    if not versions["image"].startswith("ghcr.io/anitaguptaoffice/pob-mcp:"):
        raise SystemExit("versions.json image must point at ghcr.io/anitaguptaoffice/pob-mcp")

    for plugin in marketplace.get("plugins", []):
        source = plugin.get("source", {})
        if source.get("source") != "local":
            raise SystemExit(f"unsupported plugin source for {plugin.get('name')}")

        plugin_dir = (ROOT / source.get("path", "")).resolve()
        if not plugin_dir.is_dir():
            raise SystemExit(f"plugin path does not exist: {source.get('path')}")

        plugin_json = load_json(plugin_dir / ".codex-plugin" / "plugin.json")
        if plugin_json.get("name") != plugin.get("name"):
            raise SystemExit(f"plugin name mismatch: {plugin.get('name')}")
        if plugin_json.get("version") != versions["plugin"]:
            raise SystemExit("plugin.json version does not match versions.json")

        assert_file(plugin_dir / ".mcp.json")
        assert_file(plugin_dir / "skills" / plugin.get("name") / "SKILL.md")
        assert_file(plugin_dir / "scripts" / "pob-mcp-docker.sh")

    print("market validation passed")


if __name__ == "__main__":
    main()
