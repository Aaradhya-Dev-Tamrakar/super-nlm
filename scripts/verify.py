"""Run the repository test suite from the locked uv environment.

This entrypoint deliberately invokes uv instead of a checked-in or local
virtualenv executable, so local and CI verification use the same dependency
resolution.
"""

from __future__ import annotations

import argparse
import json
import platform
import shutil
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def main() -> int:
    parser = argparse.ArgumentParser(description="Run the locked pytest suite.")
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
    junit_path = output_dir / "pytest.xml"
    metadata_path = output_dir / "run-metadata.json"

    uv = shutil.which("uv")
    if uv is None:
        print("uv is required; install it from https://docs.astral.sh/uv/", file=sys.stderr)
        return 2

    relative_junit_path = Path("verification-results") / "pytest.xml"
    command = [
        "uv",
        "run",
        "--isolated",
        "--locked",
        "--group",
        "dev",
        "pytest",
        "--junitxml",
        str(relative_junit_path),
    ]
    started_at = utc_now()
    started = time.monotonic()
    result = subprocess.run([uv, *command[1:]], cwd=root, check=False)
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
        "junit_xml": str(junit_path.relative_to(root)),
        "python": platform.python_version(),
    }
    metadata_path.write_text(json.dumps(metadata, indent=2) + "\n", encoding="utf-8")
    return result.returncode


if __name__ == "__main__":
    raise SystemExit(main())
