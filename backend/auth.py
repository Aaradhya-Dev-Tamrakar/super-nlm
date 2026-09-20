import secrets
from fastapi import Request, HTTPException, status

from backend.config import SUPER_NLM_API_KEY, SUPER_NLM_REQUIRE_AUTH_LOCAL

LOOPBACK_HOSTS = {"127.0.0.1", "::1", "localhost", "testclient"}

def is_loopback_client(request: Request) -> bool:
    """Checks whether the incoming request originated from a local loopback interface."""
    host = request.client.host if request.client else ""
    return host in LOOPBACK_HOSTS

async def verify_api_access(
    request: Request,
) -> bool:
    """
    Guards sensitive control-plane and state-mutating endpoints.
    - Local loopback connections (127.0.0.1, ::1, testclient) are permitted without authentication
      unless SUPER_NLM_REQUIRE_AUTH_LOCAL is explicitly set to True.
    - Remote requests (or local when auth is enforced) require a matching SUPER_NLM_API_KEY.
    - Supports 'Authorization: Bearer <token>', 'X-API-Key: <token>', or 'api_key' query parameter.
    """
    if is_loopback_client(request) and not SUPER_NLM_REQUIRE_AUTH_LOCAL:
        return True

    # If auth is required (remote or forced local) but no key configured on server
    if not SUPER_NLM_API_KEY:
        # If accessing remotely without server having configured an API key, reject for safety
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Remote access requires SUPER_NLM_API_KEY to be configured on the server.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    # Extract token
    token = None
    authorization = request.headers.get("authorization", "")
    if authorization.lower().startswith("bearer "):
        token = authorization[7:].strip()
    elif "x-api-key" in request.headers:
        token = request.headers.get("x-api-key")
    elif "api_key" in request.query_params:
        token = request.query_params.get("api_key")

    if not token or not secrets.compare_digest(token.strip(), SUPER_NLM_API_KEY):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or missing API key.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    return True
