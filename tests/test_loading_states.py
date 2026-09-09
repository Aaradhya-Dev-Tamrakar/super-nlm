from pathlib import Path

def test_loading_states_in_html():
    html_path = Path(__file__).resolve().parent.parent / "frontend" / "index.html"
    content = html_path.read_text(encoding="utf-8")
    assert "global-progress-bar" in content, "global-progress-bar must exist in index.html"
    assert "m3-linear-progress" in content, "m3-linear-progress class must exist in index.html"
    assert "sync-status-indicator" in content, "sync-status-indicator must exist in index.html"
    assert "sync-status-text" in content, "sync-status-text must exist in index.html"
    assert "skeleton-card" in content, "skeleton-card class must be present for dimension-matched skeletons"
    assert "cross-loading-state" in content, "cross-loading-state must exist in index.html"
    assert "cross-elapsed-timer" in content, "cross-elapsed-timer must exist in index.html"

def test_loading_states_in_css():
    css_path = Path(__file__).resolve().parent.parent / "frontend" / "style.css"
    content = css_path.read_text(encoding="utf-8")
    assert ".m3-linear-progress" in content, ".m3-linear-progress must be defined in style.css"
    assert "m3-linear-progress-indeterminate-1" in content, "Primary progress bar keyframe animation must be defined"
    assert "m3-linear-progress-indeterminate-2" in content, "Secondary progress bar keyframe animation must be defined"
    assert ".chat-loader-bubble" in content, ".chat-loader-bubble must be defined in style.css"
    assert "chat-bubble-pulse" in content, "chat-bubble-pulse animation must be defined"
    assert ".skeleton-card" in content, "Staggered skeleton card delay rules must be defined"

def test_loading_states_in_js():
    js_path = Path(__file__).resolve().parent.parent / "frontend" / "app.js"
    content = js_path.read_text(encoding="utf-8")
    assert "function setGlobalLoading(" in content, "setGlobalLoading must be defined in app.js"
    assert "function setSyncStatus(" in content, "setSyncStatus must be defined in app.js"
    assert "function startThinkingTimer(" in content, "startThinkingTimer must be defined in app.js"
    assert "function stopThinkingTimer(" in content, "stopThinkingTimer must be defined in app.js"
    assert "renderLoaderBubble(" in content, "renderLoaderBubble must be defined in app.js"
