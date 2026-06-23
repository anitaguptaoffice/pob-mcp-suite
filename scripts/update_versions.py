#!/usr/bin/env python3
import json
import os
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
VERSIONS = ROOT / "versions.json"


def required(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        raise SystemExit(f"missing required environment variable: {name}")
    return value


def main() -> None:
    data = json.loads(VERSIONS.read_text(encoding="utf-8"))
    data.update(
        {
            "image": required("IMAGE"),
            "imageDigest": required("IMAGE_DIGEST"),
            "pobMcp": required("POB_MCP_REF"),
            "pathOfBuilding": required("POB_TAG"),
            "pathOfBuildingCommit": required("POB_SHA"),
            "pathOfBuildingShortCommit": required("SHORT_SHA"),
            "pobVersion": required("POB_VERSION"),
            "treeVersion": required("TREE_VERSION"),
            "updatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
        }
    )
    VERSIONS.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
