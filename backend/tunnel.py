import os
import re
import sys
import subprocess
import threading
import urllib.request
import logging
from pathlib import Path
from typing import Optional, Callable

logger = logging.getLogger(__name__)

TOOLS_DIR = Path(__file__).resolve().parent.parent / "tools"
CLOUDFLARED_URL = "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe"
CLOUDFLARED_EXE = TOOLS_DIR / "cloudflared.exe"

def ensure_cloudflared() -> Optional[Path]:
    """Ensures cloudflared.exe is available, downloading it if needed."""
    # 1. Check if already installed in system PATH
    import shutil
    system_path = shutil.which("cloudflared")
    if system_path:
        return Path(system_path)

    # 2. Check local tools directory
    if CLOUDFLARED_EXE.exists() and CLOUDFLARED_EXE.stat().st_size > 1000000:
        return CLOUDFLARED_EXE

    # 3. Download standalone portable binary
    TOOLS_DIR.mkdir(parents=True, exist_ok=True)
    print("\n⏳ [Cloudflare Tunnel] Downloading portable cloudflared.exe (~65MB)...")
    try:
        urllib.request.urlretrieve(CLOUDFLARED_URL, CLOUDFLARED_EXE)
        print("✓ [Cloudflare Tunnel] Download complete!\n")
        return CLOUDFLARED_EXE
    except Exception as e:
        print(f"❌ [Cloudflare Tunnel] Failed to download cloudflared: {e}")
        return None

def start_cloudflare_tunnel(local_port: int, on_url_found: Optional[Callable[[str], None]] = None) -> Optional[subprocess.Popen]:
    """
    Starts an ephemeral Cloudflare Quick Tunnel forwarding to http://127.0.0.1:{local_port}.
    Captures and returns the public https://*.trycloudflare.com URL.
    """
    binary = ensure_cloudflared()
    if not binary:
        return None

    cmd = [
        str(binary), "tunnel",
        "--url", f"http://127.0.0.1:{local_port}",
        "--no-autoupdate"
    ]

    # Windows process flag to avoid popping up an extra window
    creationflags = getattr(subprocess, "CREATE_NO_WINDOW", 0x08000000)

    try:
        proc = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            bufsize=1,
            creationflags=creationflags
        )

        def _monitor_output():
            url_pattern = re.compile(r"https://[a-zA-Z0-9-]+\.trycloudflare\.com")
            found = False
            for line in proc.stderr:
                match = url_pattern.search(line)
                if match and not found:
                    found = True
                    public_url = match.group(0)
                    print("\n" + "="*65)
                    print(f" 🌍 PUBLIC CLOUDFLARE TUNNEL ACTIVE:")
                    print(f" 🔗 {public_url}")
                    print(f" 📱 Access this URL from your phone, tablet, or laptop anywhere!")
                    print("="*65 + "\n")
                    if on_url_found:
                        on_url_found(public_url)

        thread = threading.Thread(target=_monitor_output, daemon=True)
        thread.start()
        return proc

    except Exception as e:
        print(f"❌ Failed to start Cloudflare Tunnel: {e}")
        return None
