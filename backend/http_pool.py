"""Event-loop-aware shared httpx.AsyncClient connection pool."""

from __future__ import annotations

import asyncio
import contextlib
import threading
import weakref

import httpx

_GUARD = threading.Lock()
_LOOP_LOCKS: weakref.WeakKeyDictionary[asyncio.AbstractEventLoop, asyncio.Lock] = weakref.WeakKeyDictionary()
_LOOP_CLIENTS: weakref.WeakKeyDictionary[asyncio.AbstractEventLoop, httpx.AsyncClient] = weakref.WeakKeyDictionary()

DEFAULT_LIMITS = httpx.Limits(
    max_connections=40,
    max_keepalive_connections=16,
    keepalive_expiry=30.0,
)


def _create_client() -> httpx.AsyncClient:
    return httpx.AsyncClient(
        limits=DEFAULT_LIMITS,
        timeout=httpx.Timeout(60.0),
    )


def _get_loop_lock(loop: asyncio.AbstractEventLoop) -> asyncio.Lock:
    with _GUARD:
        lock = _LOOP_LOCKS.get(loop)
        if lock is None:
            lock = asyncio.Lock()
            _LOOP_LOCKS[loop] = lock
        return lock


async def get_http_client() -> httpx.AsyncClient:
    """Return a shared httpx.AsyncClient bound to the current running event loop."""
    loop = asyncio.get_running_loop()
    client = _LOOP_CLIENTS.get(loop)
    if client is not None and not client.is_closed:
        return client

    async with _get_loop_lock(loop):
        client = _LOOP_CLIENTS.get(loop)
        if client is not None and not client.is_closed:
            return client
        client = _create_client()
        _LOOP_CLIENTS[loop] = client
        return client


async def close_http_clients() -> None:
    """Close the pooled httpx.AsyncClient for the current event loop (and prune closed loops)."""
    try:
        current_loop = asyncio.get_running_loop()
    except RuntimeError:
        current_loop = None

    if current_loop is not None:
        async with _get_loop_lock(current_loop):
            client = _LOOP_CLIENTS.pop(current_loop, None)
            if client is not None and not client.is_closed:
                with contextlib.suppress(Exception):
                    await client.aclose()

    with _GUARD:
        for loop, client in list(_LOOP_CLIENTS.items()):
            if loop.is_closed() or client.is_closed:
                _LOOP_CLIENTS.pop(loop, None)
