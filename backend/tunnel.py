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

def copy_to_clipboard(text: str) -> bool:
    """Copies text to the Windows clipboard using native clip.exe."""
    try:
        proc = subprocess.Popen(["clip"], stdin=subprocess.PIPE, text=True)
        proc.communicate(input=text)
        return True
    except Exception:
        return False

def print_qr_code(url: str):
    """Prints an ASCII QR code to the terminal for easy scanning with phone camera."""
    try:
        import qrcode
        qr = qrcode.QRCode(border=1)
        qr.add_data(url)
        print(" 📷 Scan with your phone camera to open instantly:")
        qr.print_ascii(invert=True)
    except Exception:
        pass

import atexit

def _cleanup_tunnel_proc(p: subprocess.Popen):
    try:
        if p.poll() is None:
            p.terminate()
            p.wait(timeout=2)
    except Exception:
        try:
            p.kill()
        except Exception:
            pass

def start_cloudflare_tunnel(local_port: int, on_url_found: Optional[Callable[[str], None]] = None) -> Optional[subprocess.Popen]:
    """
    Starts an ephemeral Cloudflare Quick Tunnel forwarding to http://127.0.0.1:{local_port}.
    Captures the public https://*.trycloudflare.com URL, copies it to the clipboard,
    and displays an ASCII QR code for phone camera scanning.
    """
    binary = ensure_cloudflared()
    if not binary:
        return None

    cmd = [
        str(binary), "tunnel",
        "--url", f"http://127.0.0.1:{local_port}",
        "--no-autoupdate"
    ]

    extra_kwargs = {}
    if sys.platform == "win32":
        extra_kwargs["creationflags"] = getattr(subprocess, "CREATE_NO_WINDOW", 0x08000000)

    try:
        proc = subprocess.Popen(
            cmd,
            stdout=subprocess.DEVNULL,  # Prevent pipe deadlock by discarding unneeded stdout
            stderr=subprocess.PIPE,
            text=True,
            bufsize=1,
            **extra_kwargs
        )

        atexit.register(_cleanup_tunnel_proc, proc)

        def _monitor_output():
            url_pattern = re.compile(r"https://[a-zA-Z0-9-]+\.trycloudflare\.com")
            found = False
            for line in proc.stderr:
                match = url_pattern.search(line)
                if match and not found:
                    found = True
                    public_url = match.group(0)

                    # 1. Copy directly to Windows clipboard
                    copied = copy_to_clipboard(public_url)

                    print("\n" + "="*65)
                    print(f" 🌍 PUBLIC CLOUDFLARE TUNNEL ACTIVE:")
                    print(f" 🔗 {public_url}")
                    if copied:
                        print(f" 📋 [COPIED TO CLIPBOARD!] Press Ctrl+V to paste anywhere.")
                    print(f" 📱 Access this URL from your phone, tablet, or laptop anywhere!")
                    print("="*65 + "\n")

                    # 2. Print QR Code for instant phone camera scanning
                    print_qr_code(public_url)

                    if on_url_found:
                        on_url_found(public_url)

        thread = threading.Thread(target=_monitor_output, daemon=True)
        thread.start()
        return proc

    except Exception as e:
        print(f"❌ Failed to start Cloudflare Tunnel: {e}")
        return None
