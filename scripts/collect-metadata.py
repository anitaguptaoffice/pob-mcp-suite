#!/usr/bin/env python3
import re
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def git(*args: str) -> str:
    return subprocess.check_output(["git", *args], cwd=ROOT, text=True).strip()


def output(name: str, value: str) -> None:
    print(f"{name}={value}")


def path_of_building_sha() -> str:
    message = git("log", "-1", "--format=%B", "--", "vendor/PathOfBuilding")
    match = re.search(r"commit '([0-9a-f]{7,40})'", message)
    if match:
        return match.group(1)
    return git("rev-parse", "HEAD")


def latest_tree_version() -> str:
    versions = []
    for path in (ROOT / "vendor" / "PathOfBuilding" / "src" / "TreeData").glob("3_*"):
        name = path.name
        if name.endswith("_alternate") or "_ruthless" in name:
            continue
        parts = name.split("_")
        if len(parts) == 2 and all(part.isdigit() for part in parts):
            versions.append((int(parts[0]), int(parts[1]), name))
    return sorted(versions)[-1][2]


def pob_version() -> str:
    manifest = (ROOT / "vendor" / "PathOfBuilding" / "manifest.xml").read_text(encoding="utf-8")
    match = re.search(r'<Version number="([^"]+)"', manifest)
    if not match:
        raise SystemExit("could not find PoB version in manifest.xml")
    return match.group(1)


def main() -> None:
    pob_sha = path_of_building_sha()
    output("pob_sha", pob_sha)
    output("short_sha", pob_sha[:7])
    output("pob_tag", f"vendor-{pob_sha[:7]}")
    output("pob_version", pob_version())
    output("tree_version", latest_tree_version())
    output("suite_sha", git("rev-parse", "HEAD"))


if __name__ == "__main__":
    main()
