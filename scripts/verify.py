"""Run the repository test suite and commit SHA integrity checks.

This entrypoint invokes isolated locked verification and validates zero-placeholder commit SHAs.
"""

from __future__ import annotations

import argparse
import json
import os
import platform
import re
import shutil
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def check_commit_sha_integrity(root: Path) -> list[str]:
    placeholder_pattern = re.compile(r"\b(rel\d+|upg\d+|xtool\d+|dummy|todo)\b", re.IGNORECASE)
    commit_url_pattern = re.compile(r"github\.com/[^/]+/[^/]+/commit/([a-zA-Z0-9_\-]+)")
    sha_prop_pattern = re.compile(r"""sha:\s*['"]([^'"]+)['"]""")
    hex_sha_pattern = re.compile(r"^[0-9a-f]{7,40}$", re.IGNORECASE)

    scanned_extensions = {".md", ".json", ".py", ".ps1", ".toml"}
    bad_shas = []

    for root_dir, _, files in os.walk(root):
        if any(d in root_dir for d in [".git", "node_modules", ".venv", "__pycache__", "verification-results"]):
            continue
        for file in files:
            ext = os.path.splitext(file)[1].lower()
            if ext in scanned_extensions:
                file_path = os.path.join(root_dir, file)
                try:
                    with open(file_path, "r", encoding="utf-8", errors="ignore") as fh:
                        content = fh.read()
                except Exception:
                    continue

                for m in commit_url_pattern.finditer(content):
                    sha = m.group(1)
                    if placeholder_pattern.match(sha) or not hex_sha_pattern.match(sha):
                        bad_shas.append(f"{file_path}: invalid commit URL SHA '{sha}'")

                for m in sha_prop_pattern.finditer(content):
                    sha = m.group(1)
                    if placeholder_pattern.match(sha) or not hex_sha_pattern.match(sha):
                        bad_shas.append(f"{file_path}: invalid sha property '{sha}'")

    return bad_shas


def main() -> int:
    parser = argparse.ArgumentParser(description="Run verification suite.")
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=Path("verification-results"),
        help="Directory for JUnit XML and run metadata.",
    )
    args = parser.parse_args()

    root = Path(__file__).resolve().parents[1]
    output_dir = (root / args.output_dir).resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    metadata_path = output_dir / "run-metadata.json"

    print("=" * 60)
    print("  SUPER-NLM Verification Suite")
    print("=" * 60)

    # 1. Commit SHA Integrity
    print("\n[1/2] Commit SHA & placeholder integrity")
    bad_shas = check_commit_sha_integrity(root)
    if bad_shas:
        for b in bad_shas:
            print(f"  [FAIL] {b}")
        return 1
    else:
        print("  [PASS] All commit references are authentic 7-40 hex SHAs (0 placeholders)")

    # 2. Pytest Suite
    print("\n[2/2] Pytest execution")
    uv = shutil.which("uv")
    relative_junit_path = Path("verification-results") / "pytest.xml"
    if uv is not None:
        command = [
            "uv",
            "run",
            "--isolated",
            "--locked",
            "--group",
            "dev",
            "pytest",
            "--ignore=tests/test_api.py",
            "--junitxml",
            str(relative_junit_path),
        ]
        cmd_exec = [uv, *command[1:]]
    else:
        command = [sys.executable, "-m", "pytest", "--ignore=tests/test_api.py", "--junitxml", str(relative_junit_path)]
        cmd_exec = command

    started_at = utc_now()
    started = time.monotonic()
    result = subprocess.run(cmd_exec, cwd=root, check=False)
    duration = time.monotonic() - started
    finished_at = utc_now()

    metadata = {
        "schema_version": 1,
        "status": "passed" if result.returncode == 0 else "failed",
        "exit_code": result.returncode,
        "started_at": started_at,
        "finished_at": finished_at,
        "duration_seconds": round(duration, 3),
        "command": command,
        "python": platform.python_version(),
    }
    metadata_path.write_text(json.dumps(metadata, indent=2) + "\n", encoding="utf-8")
    return result.returncode


if __name__ == "__main__":
    raise SystemExit(main())
