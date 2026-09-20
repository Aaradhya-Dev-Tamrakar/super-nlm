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

# Copy application source code
COPY backend/ /app/backend/
COPY frontend/ /app/frontend/
COPY data/ /app/data/
COPY pyproject.toml uv.lock /app/

# Install application dependencies from the repository lockfile. The CLI is a
# separate uv tool because it is not a Python project dependency.
RUN pip install --no-cache-dir uv \
    && uv sync --locked --no-dev \
    && uv tool install notebooklm-mcp-cli==0.11.5
ENV PATH="/root/.local/bin:${PATH}"

EXPOSE 8080

CMD ["sh", "-c", ".venv/bin/uvicorn backend.app:app --host 0.0.0.0 --port ${PORT:-8080}"]
