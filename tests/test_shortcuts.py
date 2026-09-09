import re
from pathlib import Path

def test_shortcuts_in_html():
    html_path = Path(__file__).resolve().parent.parent / "frontend" / "index.html"
    content = html_path.read_text(encoding="utf-8")

    assert "modal-shortcuts" in content, "modal-shortcuts must exist in index.html"
    assert "btn-shortcuts-toggle" in content, "btn-shortcuts-toggle must exist in index.html"
    assert "close-modal-shortcuts" in content, "close-modal-shortcuts must exist in index.html"
    assert "btn-close-shortcuts-footer" in content, "btn-close-shortcuts-footer must exist in index.html"
    assert "btn-tips-shortcuts" in content, "btn-tips-shortcuts must exist in index.html"
    assert "0" in content, "Key 0 must be documented in index.html"
    assert "kbd-badge" in content, "kbd-badge class must be used in index.html"
    print("  [PASS] HTML: All shortcut elements and modal markup present.")

def test_shortcuts_in_css():
    css_path = Path(__file__).resolve().parent.parent / "frontend" / "style.css"
    content = css_path.read_text(encoding="utf-8")

    assert ".kbd-badge" in content, ".kbd-badge must be defined in style.css"
    print("  [PASS] CSS: .kbd-badge styling defined.")

def test_shortcuts_in_js():
    js_path = Path(__file__).resolve().parent.parent / "frontend" / "app.js"
    content = js_path.read_text(encoding="utf-8")

    # Key functions
    assert "function toggleThemeMode(" in content, "toggleThemeMode must be defined"
    assert "function toggleSelectAllVisible(" in content, "toggleSelectAllVisible must be defined"
    assert "function getVisibleNotebooks(" in content, "getVisibleNotebooks must be defined"

    # Key shortcuts checks
    assert "e.key === '0'" in content, "Key '0' handler must exist"
    assert "e.key === '?'" in content, "Key '?' handler must exist"
    assert "modal-shortcuts" in content, "modal-shortcuts handled in JS"
    assert "toggleThemeMode()" in content, "toggleThemeMode called in handler"
    assert "toggleSelectAllVisible()" in content, "toggleSelectAllVisible called in handler"
    print("  [PASS] JS: Keyboard shortcuts and handlers verified.")

if __name__ == "__main__":
    print("Testing Super-NLM Keyboard Shortcuts implementation...")
    test_shortcuts_in_html()
    test_shortcuts_in_css()
    test_shortcuts_in_js()
    print("ALL SHORTCUT TESTS PASSED!")
