"""Subprocess execution and Win32 Job Object lifecycle for the nlm CLI."""

from __future__ import annotations

import asyncio
import atexit
import importlib.util
import logging
import os
import subprocess
import sys
import threading
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any

from backend.config import NLM_EXECUTABLE, SUPER_NLM_FLEET_CONCURRENCY

logger = logging.getLogger("backend.nlm_client")

CREATE_NO_WINDOW = getattr(subprocess, "CREATE_NO_WINDOW", 0x08000000)
_NLM_JOB_STATE: dict[str, Any] = {"handle": None, "initialized": False}
_EXECUTOR_LOCK = threading.Lock()
_NLM_EXECUTOR_STATE: dict[str, ThreadPoolExecutor | None] = {"executor": None}


def _get_nlm_executor() -> ThreadPoolExecutor:
    """Return the dedicated bounded ThreadPoolExecutor for NLM CLI subprocesses."""
    executor = _NLM_EXECUTOR_STATE["executor"]
    if executor is None:
        with _EXECUTOR_LOCK:
            executor = _NLM_EXECUTOR_STATE["executor"]
            if executor is None:
                executor = ThreadPoolExecutor(
                    max_workers=max(4, SUPER_NLM_FLEET_CONCURRENCY * 2),
                    thread_name_prefix="nlm-exec",
                )
                _NLM_EXECUTOR_STATE["executor"] = executor
    return executor


def shutdown_nlm_executor(wait: bool = False) -> None:
    """Shut down the dedicated NLM subprocess ThreadPoolExecutor."""
    with _EXECUTOR_LOCK:
        executor = _NLM_EXECUTOR_STATE["executor"]
        if executor is not None:
            executor.shutdown(wait=wait)
            _NLM_EXECUTOR_STATE["executor"] = None


atexit.register(shutdown_nlm_executor, False)


def _facade():
    import backend.nlm_client as facade

    return facade


def _get_nlm_job_object():
    """Initializes and returns a Win32 Job Object configured to kill children on close."""
    if sys.platform != "win32":
        return None
    if _NLM_JOB_STATE["initialized"]:
        return _NLM_JOB_STATE["handle"]

    _NLM_JOB_STATE["initialized"] = True
    try:
        import ctypes
        from ctypes import wintypes

        kernel32 = ctypes.windll.kernel32
        kernel32.CreateJobObjectW.restype = wintypes.HANDLE
        kernel32.CreateJobObjectW.argtypes = [ctypes.c_void_p, wintypes.LPCWSTR]
        kernel32.SetInformationJobObject.restype = wintypes.BOOL
        kernel32.AssignProcessToJobObject.restype = wintypes.BOOL
        kernel32.AssignProcessToJobObject.argtypes = [wintypes.HANDLE, wintypes.HANDLE]

        class JOBOBJECT_BASIC_LIMIT_INFORMATION(ctypes.Structure):
            _fields_ = [
                ("PerProcessUserTimeLimit", wintypes.LARGE_INTEGER),
                ("PerJobUserTimeLimit", wintypes.LARGE_INTEGER),
                ("LimitFlags", wintypes.DWORD),
                ("MinimumWorkingSetSize", ctypes.c_size_t),
                ("MaximumWorkingSetSize", ctypes.c_size_t),
                ("ActiveProcessLimit", wintypes.DWORD),
                ("Affinity", ctypes.c_size_t),
                ("PriorityClass", wintypes.DWORD),
                ("SchedulingClass", wintypes.DWORD),
            ]

        class IO_COUNTERS(ctypes.Structure):
            _fields_ = [
                ("ReadOperationCount", ctypes.c_uint64),
                ("WriteOperationCount", ctypes.c_uint64),
                ("OtherOperationCount", ctypes.c_uint64),
                ("ReadTransferCount", ctypes.c_uint64),
                ("WriteTransferCount", ctypes.c_uint64),
                ("OtherTransferCount", ctypes.c_uint64),
            ]

        class JOBOBJECT_EXTENDED_LIMIT_INFORMATION(ctypes.Structure):
            _fields_ = [
                ("BasicLimitInformation", JOBOBJECT_BASIC_LIMIT_INFORMATION),
                ("IoInfo", IO_COUNTERS),
                ("ProcessMemoryLimit", ctypes.c_size_t),
                ("JobMemoryLimit", ctypes.c_size_t),
                ("PeakProcessMemoryUsed", ctypes.c_size_t),
                ("PeakJobMemoryUsed", ctypes.c_size_t),
            ]

        h_job = kernel32.CreateJobObjectW(None, None)
        if not h_job:
            return None

        info = JOBOBJECT_EXTENDED_LIMIT_INFORMATION()
        job_object_limit_kill_on_job_close = 0x2000
        info.BasicLimitInformation.LimitFlags = job_object_limit_kill_on_job_close
        job_object_extended_limit_information = 9

        ok = kernel32.SetInformationJobObject(
            h_job,
            job_object_extended_limit_information,
            ctypes.byref(info),
            ctypes.sizeof(info),
        )
        if not ok:
            kernel32.CloseHandle(h_job)
            return None

        _NLM_JOB_STATE["handle"] = h_job
        return _NLM_JOB_STATE["handle"]
    except Exception:
        return None


def _bind_to_nlm_job(proc_or_pid: Any) -> bool:
    """Assigns a child process or PID to the Windows Job Object."""
    if sys.platform != "win32":
        return False
    h_job = _get_nlm_job_object()
    if not h_job:
        return False

    try:
        import ctypes

        kernel32 = ctypes.windll.kernel32

        if hasattr(proc_or_pid, "_handle") and proc_or_pid._handle:
            return bool(kernel32.AssignProcessToJobObject(h_job, int(proc_or_pid._handle)))

        pid = getattr(proc_or_pid, "pid", proc_or_pid if isinstance(proc_or_pid, int) else None)
        if isinstance(pid, int):
            process_set_quota = 0x0100
            process_terminate = 0x0001
            h_proc = kernel32.OpenProcess(process_set_quota | process_terminate, False, pid)
            if h_proc:
                try:
                    return bool(kernel32.AssignProcessToJobObject(h_job, h_proc))
                finally:
                    kernel32.CloseHandle(h_proc)
    except Exception as exc:
        logger.debug("Failed to assign process to Win32 job object: %s", exc)
    return False


def _run_subprocess_sync(cmd: list[str], timeout: int, env: dict[str, str] | None = None) -> dict[str, Any]:
    extra_kwargs: dict[str, Any] = {}
    if sys.platform == "win32":
        extra_kwargs["creationflags"] = getattr(subprocess, "CREATE_NO_WINDOW", 0x08000000)

    try:
        proc = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            encoding="utf-8",
            errors="replace",
            env=env,
            **extra_kwargs,
        )
        _bind_to_nlm_job(proc)
        try:
            stdout, stderr = proc.communicate(timeout=timeout)
        except subprocess.TimeoutExpired:
            proc.kill()
            proc.wait()
            return {
                "returncode": -1,
                "stdout": "",
                "stderr": f"Command timed out after {timeout} seconds",
                "success": False,
            }

        out = stdout.replace("\r\n", "\n").strip()
        err = stderr.replace("\r\n", "\n").strip()
        if proc.returncode != 0 and not err and out:
            err = out
        return {
            "returncode": proc.returncode,
            "stdout": out,
            "stderr": err,
            "success": proc.returncode == 0,
        }
    except Exception as e:
        return {
            "returncode": -1,
            "stdout": "",
            "stderr": str(e) or type(e).__name__,
            "success": False,
        }


async def _exec_subprocess(cmd: list[str], timeout: int = 60, env: dict[str, str] | None = None) -> dict[str, Any]:
    logger.info(f"Running command: {' '.join(cmd)}")
    proc = None
    run_sync = _facade()._run_subprocess_sync
    try:
        # On Windows, synchronous subprocess in dedicated executor is immune to IOCP pipe/reloader conflicts
        if sys.platform == "win32":
            loop = asyncio.get_running_loop()
            task = asyncio.ensure_future(loop.run_in_executor(_get_nlm_executor(), run_sync, cmd, timeout, env))
            try:
                return await asyncio.shield(task)
            except asyncio.CancelledError:
                # A Python thread cannot be cancelled: retain output-file locks until it exits.
                await task
                raise

        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            env=env,
        )
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=timeout)
        out_str = stdout.decode("utf-8", errors="replace").replace("\r\n", "\n").strip()
        err_str = stderr.decode("utf-8", errors="replace").replace("\r\n", "\n").strip()
        if proc.returncode != 0 and not err_str and out_str:
            err_str = out_str

        return {
            "returncode": proc.returncode,
            "stdout": out_str,
            "stderr": err_str,
            "success": proc.returncode == 0,
        }
    except NotImplementedError:
        logger.info("Current event loop does not support create_subprocess_exec, falling back to NLM executor")
        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(_get_nlm_executor(), run_sync, cmd, timeout, env)
    except asyncio.TimeoutError:
        if proc is not None:
            try:
                proc.kill()
                await proc.wait()
            except Exception as cleanup_err:
                logger.debug("Process cleanup after timeout ignored error: %s", cleanup_err)
        return {
            "returncode": -1,
            "stdout": "",
            "stderr": f"Command timed out after {timeout} seconds",
            "success": False,
        }
    except Exception as e:
        return {
            "returncode": -1,
            "stdout": "",
            "stderr": str(e) or type(e).__name__,
            "success": False,
        }


async def run_nlm_cmd(args: list[str], timeout: int = 60, profile_id: str | None = None) -> dict[str, Any]:
    env = None
    if profile_id is not None:
        env = os.environ.copy()
        env["NLM_PROFILE"] = profile_id
        # Explicit account selection takes precedence over inherited cookie auth.
        env.pop("NOTEBOOKLM_COOKIES", None)
    return await _facade()._exec_subprocess([NLM_EXECUTABLE, *args], timeout=timeout, env=env)


def _resolve_nlm_python() -> str | None:
    """Locate the Python executable whose environment has notebooklm_tools installed."""
    override = os.environ.get("NLM_PYTHON_EXECUTABLE", "").strip()
    if override and Path(override).exists():
        return override

    nlm_path = Path(NLM_EXECUTABLE)
    if nlm_path.is_absolute() and nlm_path.parent.exists():
        for name in ("python.exe", "python"):
            candidate = nlm_path.parent / name
            if candidate.exists():
                return str(candidate)

    uv_candidates = []
    for env_var in ("APPDATA", "LOCALAPPDATA"):
        base = os.environ.get(env_var, "").strip()
        if base:
            uv_candidates.append(Path(base) / "uv" / "tools" / "notebooklm-mcp-cli" / "Scripts" / "python.exe")
    uv_candidates.append(Path.home() / ".local" / "share" / "uv" / "tools" / "notebooklm-mcp-cli" / "bin" / "python")
    for candidate in uv_candidates:
        if candidate.exists():
            return str(candidate)

    if importlib.util.find_spec("notebooklm_tools") is not None:
        return sys.executable
    return None
