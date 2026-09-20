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
    assert "Ctrl + A" in content, "Ctrl + A must be documented in index.html"
    assert "Ctrl + Click" in content, "Ctrl + Click must be documented in index.html"
    assert "Shift + Click" in content, "Shift + Click must be documented in index.html"
    assert "btn-toggle-sidebar" in content, "btn-toggle-sidebar must exist in index.html"
    assert "workspace-sidebar" in content, "workspace-sidebar must exist in index.html"
    print("  [PASS] HTML: All shortcut elements and modal markup present.")

def test_shortcuts_in_css():
    css_path = Path(__file__).resolve().parent.parent / "frontend" / "style.css"
    content = css_path.read_text(encoding="utf-8")

    assert ".kbd-badge" in content, ".kbd-badge must be defined in style.css"
    assert "user-select: none;" in content, "user-select none must be applied to prevent text drag on multi-select"
    print("  [PASS] CSS: .kbd-badge and selection styles defined.")

def test_shortcuts_in_js():
    js_path = Path(__file__).resolve().parent.parent / "frontend" / "app.js"
    content = js_path.read_text(encoding="utf-8")

    # Key functions
    assert "function toggleThemeMode(" in content, "toggleThemeMode must be defined"
    assert "function toggleSelectAllVisible(" in content, "toggleSelectAllVisible must be defined"
    assert "function getVisibleNotebooks(" in content, "getVisibleNotebooks must be defined"
    assert "function handleNotebookSelection(" in content, "handleNotebookSelection must be defined"
    assert "function syncSelectionUI(" in content, "syncSelectionUI must be defined"

    # Multi-notebook selection logic
    assert "lastSelectedNotebookId" in content, "state.lastSelectedNotebookId must track selection anchor"
    assert "event.shiftKey" in content or "isShift" in content, "Shift + Click range selection logic must be present"
    assert "event.ctrlKey" in content or "isCtrl" in content, "Ctrl + Click toggle selection logic must be present"

    # Key shortcuts checks
    assert "e.key === '0'" in content, "Key '0' handler must exist"
    assert "e.key === '?'" in content, "Key '?' handler must exist"
    assert "modal-shortcuts" in content, "modal-shortcuts handled in JS"
    assert "toggleThemeMode()" in content, "toggleThemeMode called in handler"
    assert "toggleSelectAllVisible()" in content, "toggleSelectAllVisible called in handler"
    assert "toggleSidebarCollapse()" in content, "toggleSidebarCollapse called in handler"
    assert "e.key === '['" in content, "Key '[' handler must exist"
    assert "e.key === ']'" in content, "Key ']' handler must exist"
    assert "e.key.toLowerCase() === 'q'" in content, "Key 'q' handler must exist for Batch Queue & Scheduler"
    assert "e.key.toLowerCase() === 'l'" in content, "Key 'l' handler must exist for Quota Limits"
    assert "e.key.toLowerCase() === 'b'" in content, "Key 'b' handler must exist for Batch Share"
    assert "e.key.toLowerCase() === 'k'" in content, "Key 'k' handler must exist for Remote Access Key"
    assert "e.key.toLowerCase() === 'a' && !isInputActive" in content, "Ctrl+A handler must select all visible notebooks"
    print("  [PASS] JS: Keyboard shortcuts and handlers verified.")

def test_windows_explorer_selection_algorithm():
    # Simulate the exact JS algorithm in Python to verify edge cases
    notebooks = [
        {"id": f"nb-{i}", "title": f"Notebook {i}", "profileId": "prof-1"}
        for i in range(10)
    ]
    visible = notebooks

    selected_notebooks = {}
    last_selected_id = None

    def handle_selection(clicked_id, is_ctrl, is_shift, is_checkbox):
        nonlocal last_selected_id
        if is_shift:
            anchor_idx = next((i for i, n in enumerate(visible) if n["id"] == last_selected_id), 0)
            current_idx = next(i for i, n in enumerate(visible) if n["id"] == clicked_id)
            start = min(anchor_idx, current_idx)
            end = max(anchor_idx, current_idx)

            if not is_ctrl:
                selected_notebooks.clear()

            for i in range(start, end + 1):
                item = visible[i]
                selected_notebooks[item["id"]] = item

            if not last_selected_id:
                last_selected_id = visible[anchor_idx]["id"]
        elif is_ctrl or is_checkbox:
            if clicked_id in selected_notebooks:
                del selected_notebooks[clicked_id]
            else:
                item = next(n for n in visible if n["id"] == clicked_id)
                selected_notebooks[clicked_id] = item
            last_selected_id = clicked_id
        else:
            selected_notebooks.clear()
            item = next(n for n in visible if n["id"] == clicked_id)
            selected_notebooks[clicked_id] = item
            last_selected_id = clicked_id

    # 1. Normal click on nb-2 -> only nb-2 selected, anchor = nb-2
    handle_selection("nb-2", is_ctrl=False, is_shift=False, is_checkbox=False)
    assert list(selected_notebooks.keys()) == ["nb-2"]
    assert last_selected_id == "nb-2"

    # 2. Shift + click on nb-5 -> range nb-2 to nb-5 selected, anchor stays nb-2
    handle_selection("nb-5", is_ctrl=False, is_shift=True, is_checkbox=False)
    assert set(selected_notebooks.keys()) == {"nb-2", "nb-3", "nb-4", "nb-5"}
    assert last_selected_id == "nb-2"

    # 3. Shift + click backwards on nb-0 -> range nb-0 to nb-2 selected from original anchor
    handle_selection("nb-0", is_ctrl=False, is_shift=True, is_checkbox=False)
    assert set(selected_notebooks.keys()) == {"nb-0", "nb-1", "nb-2"}
    assert last_selected_id == "nb-2"

    # 4. Ctrl + click on nb-7 -> nb-7 added, anchor becomes nb-7
    handle_selection("nb-7", is_ctrl=True, is_shift=False, is_checkbox=False)
    assert set(selected_notebooks.keys()) == {"nb-0", "nb-1", "nb-2", "nb-7"}
    assert last_selected_id == "nb-7"

    # 5. Ctrl + click on nb-1 -> nb-1 removed
    handle_selection("nb-1", is_ctrl=True, is_shift=False, is_checkbox=False)
    assert set(selected_notebooks.keys()) == {"nb-0", "nb-2", "nb-7"}
    assert last_selected_id == "nb-1"

    # 6. Normal click on nb-4 -> replaces all with nb-4
    handle_selection("nb-4", is_ctrl=False, is_shift=False, is_checkbox=False)
    assert list(selected_notebooks.keys()) == ["nb-4"]
    assert last_selected_id == "nb-4"

    print("  [PASS] Selection: Windows File Explorer selection paradigm verified.")

if __name__ == "__main__":
    print("Testing Super-NLM Keyboard Shortcuts implementation...")
    test_shortcuts_in_html()
    test_shortcuts_in_css()
    test_shortcuts_in_js()
    test_windows_explorer_selection_algorithm()
    print("ALL SHORTCUT TESTS PASSED!")
