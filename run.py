import os
import sys
import socket
import webbrowser
import threading
import time
import asyncio
import argparse
import subprocess
import shutil

# --- Windows Console & Runtime Performance Optimizations ---
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

os.environ["PYTHONUTF8"] = "1"
os.environ["PYTHONIOENCODING"] = "utf-8"

if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())

HOST = "127.0.0.1"

def find_available_port(preferred_port: int = 8000, host: str = "127.0.0.1") -> int:
    """Finds the first available port starting from preferred_port."""
    for port in range(preferred_port, preferred_port + 50):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            try:
                s.bind((host, port))
                return port
            except OSError:
                continue
    return preferred_port

def open_browser(url: str):
    time.sleep(1.0)
    webbrowser.open(url)

def upgrade_notebooklm_cli():
    """Upgrades notebooklm-mcp-cli via uv tool at launch."""
    uv_bin = shutil.which("uv")
    if not uv_bin:
        fallback = os.path.join(os.environ.get("USERPROFILE", ""), ".local", "bin", "uv.exe")
        if os.path.exists(fallback):
            uv_bin = fallback
        else:
            uv_bin = "uv"
    print("📦 Checking for updates to Gemini Notebook CLI engine (notebooklm-mcp-cli)...")
    try:
        res = subprocess.run(
            [uv_bin, "tool", "upgrade", "notebooklm-mcp-cli"],
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=30,
            check=False
        )
        output = (res.stdout or res.stderr or "").strip()
        if output:
            for line in output.splitlines():
                print(f"   {line}")
    except Exception as e:
        print(f"   ⚠️ Could not check for updates: {e}")

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Super-NLM Hub Launcher")
    parser.add_argument("--port", type=int, default=None, help="Port to bind (default: auto-detect from 8000)")
    parser.add_argument("--tunnel", action="store_true", help="Launch a Cloudflare Tunnel for secure remote access anywhere")
    parser.add_argument("--no-browser", action="store_true", help="Don't open browser automatically")
    parser.add_argument("--no-upgrade", action="store_true", help="Skip checking for Gemini Notebook CLI updates at launch")
    args = parser.parse_args()

    if not args.no_upgrade:
        upgrade_notebooklm_cli()

    desired_port = args.port or int(os.environ.get("SUPER_NLM_PORT", 8000))
    port = find_available_port(desired_port, HOST)

    url = f"http://{HOST}:{port}"

    print("\n" + "="*65)
    print(" 🚀 Super-NLM Hub (Optimized for Windows Dev Drive & ReFS)")
    print(" ⭐️ Pro AI Engine : aaradhyadevtmr@gmail.com")
    if port != desired_port:
        print(f" ℹ️  Port {desired_port} was busy. Automatically switched to port {port}!")
    print(f" 🌐 Dashboard URL  : {url}")
    print("="*65 + "\n")

    if args.tunnel:
        from backend.tunnel import start_cloudflare_tunnel
        start_cloudflare_tunnel(port)

    if not args.no_browser:
        threading.Thread(target=open_browser, args=(url,), daemon=True).start()

    import uvicorn
    loop_param = "asyncio:ProactorEventLoop" if sys.platform == "win32" else "asyncio"
    uvicorn.run(
        "backend.app:app",
        host=HOST,
        port=port,
        reload=True,
        loop=loop_param,
        timeout_keep_alive=30
    )
