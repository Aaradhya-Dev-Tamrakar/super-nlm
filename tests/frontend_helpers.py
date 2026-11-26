import subprocess
from pathlib import Path

FRONTEND_DIR = Path(__file__).resolve().parent.parent / "frontend"


def iter_frontend_esm_files() -> list[Path]:
    """Return frontend/app.js and all frontend/js/*.js ES module files in deterministic order."""
    files = [FRONTEND_DIR / "app.js"]
    js_dir = FRONTEND_DIR / "js"
    if js_dir.is_dir():
        files.extend(sorted(js_dir.glob("*.js")))
    return [p for p in files if p.exists()]


def read_frontend_js_sources() -> str:
    """Read and concatenate all frontend ES module sources for static assertions."""
    return "\n".join(p.read_text(encoding="utf-8") for p in iter_frontend_esm_files())


def check_all_frontend_js_syntax() -> None:
    """Validate JS syntax for all frontend ES modules and classic scripts via Node."""
    for path in iter_frontend_esm_files():
        proc = subprocess.run(
            ["node", "--input-type=module", "--check"],
            input=path.read_text(encoding="utf-8"),
            capture_output=True,
            text=True,
            check=False,
        )
        assert proc.returncode == 0, f"Syntax error in {path}: {proc.stderr or proc.stdout}"

    fleet_js = FRONTEND_DIR / "fleet.js"
    if fleet_js.exists():
        proc = subprocess.run(
            ["node", "--check", str(fleet_js)],
            capture_output=True,
            text=True,
            check=False,
        )
        assert proc.returncode == 0, f"Syntax error in {fleet_js}: {proc.stderr or proc.stdout}"
