import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

APP_JS = Path(__file__).resolve().parent.parent / "frontend" / "app.js"


def test_frontend_defines_tier_partition_and_group_headers():
    src = APP_JS.read_text(encoding="utf-8")
    assert "function partitionProfilesByTier(" in src
    assert "AI Pro · Family Plan" in src
    assert "Standard Accounts" in src
    assert "Independent Pro quota per account" in src
    assert "Independent standard quota per account" in src


def test_frontend_app_js_passes_node_syntax_check():
    proc = subprocess.run(
        ["node", "--check", str(APP_JS)],
        capture_output=True,
        text=True,
        check=False,
    )
    assert proc.returncode == 0, proc.stderr or proc.stdout
