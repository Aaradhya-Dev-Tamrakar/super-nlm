import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from tests.frontend_helpers import (
    check_all_frontend_js_syntax,
    read_frontend_js_sources,
)


def test_frontend_defines_tier_partition_and_group_headers():
    src = read_frontend_js_sources()
    assert "function partitionProfilesByTier(" in src
    assert "AI Pro · Family Plan" in src
    assert "Standard Accounts" in src
    assert "Independent Pro quota per account" in src
    assert "Independent standard quota per account" in src


def test_frontend_app_js_passes_node_syntax_check():
    check_all_frontend_js_syntax()
