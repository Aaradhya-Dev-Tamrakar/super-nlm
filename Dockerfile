# Super-NLM Hub - Dockerfile for Google Cloud Run
FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONUTF8=1 \
    PORT=8080

WORKDIR /app

# Install system utilities
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Install Python packages: notebooklm-mcp-cli provides the 'nlm' CLI
RUN pip install --no-cache-dir \
    notebooklm-mcp-cli \
    fastapi \
    uvicorn \
    pydantic \
    httpx \
    aiosqlite \
    qrcode \
    mcp

# Copy application source code
COPY backend/ /app/backend/
COPY frontend/ /app/frontend/
COPY data/ /app/data/
COPY pyproject.toml /app/

EXPOSE 8080

CMD ["sh", "-c", "uvicorn backend.app:app --host 0.0.0.0 --port ${PORT:-8080}"]
