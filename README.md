# Super-NLM Hub 🚀
> **Multi-Account Unified Dashboard & Parallel Agent MCP Server for Google Gemini Notebook**  
> Access, search, chat, categorize, and synthesize across $N$ Google accounts simultaneously.

---

## 🌟 Key Features

- **$N$-Account Architecture:** Add, edit, test, and delete an arbitrary number of Google accounts (Personal, Work, College, School, Business, etc.).
- **Editable Profile Customization:** Modify display labels, Google emails, account tiers (`Standard` vs. `Pro AI`), and custom badge colors (palette swatches or hex) without re-authenticating.
- **Pro AI Engine Routing:** `aaradhyadevtmr@gmail.com` is configured as the primary **Pro AI** engine for heavy workloads, high rate limits, and multi-notebook synthesis.
- **Unified Notebook Explorer & Study Filter:** Parallel fetching aggregates all your notebooks from every account into a single searchable dashboard. Filter between **All**, **Study / Course NLMs** (with automatic course code detection), and **Projects**.
- **Global Fast Search (`Ctrl+K` or `/`):** Instantly filter notebooks across all accounts by title, owner email, or course code.
- **Interactive Keyboard Shortcuts (`?`):** Navigate the entire hub rapidly with single-key shortcuts (`/`, `s`, `r`, `a`, `c`, `?`, `Esc`).
- **In-App Quick Chat:** Ask questions directly to any notebook without switching Google accounts or opening browser tabs, featuring persistent session pinning, markdown rendering, and citations.
- **Cross-Account Synthesis:** Select 2 or more notebooks across different accounts and synthesize them using your Pro AI model, complete with a real-time progression indicator and a floating background dock pill.
- **Export to PDF:** Save synthesis summaries and source notebook responses as clean, professional PDF reports with scope selection (*Both Synthesis & Raw*, *Synthesis Only*, or *Raw Notebooks Only*).
- **Model Context Protocol (MCP) Server:** Native MCP integration with round-robin multi-account rotation, allowing parallel AI agents in Antigravity, Claude Desktop, or Claude Code to query notebooks without exhausting rate limits on any single account.
- **Automated Git Synchronization (`sync.ps1`):** Built-in repository synchronization engine with pre-commit secret leak protection, intelligent component-scoped conventional commits, and rebase conflict auto-recovery.

---

## 🤖 Super-NLM MCP Server (Account Rotation for Parallel Agents)

Super-NLM includes a built-in MCP server (`super-nlm-mcp`) designed specifically for parallel agent orchestration. When multiple AI agents query notebooks concurrently, single-account quotas are quickly exhausted. Super-NLM distributes queries evenly across all your configured Google accounts and handles rate limits automatically.

### Key Capabilities

- **Round-Robin Rotation:** A global monotonic counter alternates queries across all authenticated Google accounts (`default`, `secondary`, etc.) so quota load is balanced evenly.
- **Two-Tiered Intelligent Quota Cooldown:**
  - **Burst Concurrency (HTTP 429 / RPM):** When rapid parallel queries trigger a temporary throttle, the account enters a **120s cooldown** while Google's per-minute token bucket refills.
  - **Daily Quota Ceiling (RPD):** When a free/standard account hits its daily query limit (*"reached your daily limit"*), it is placed in a **cooldown until 00:00 UTC midnight** (~12–24h). Parallel agents won't waste any time pinging an account whose daily quota is depleted.
- **Seamless Retry Fallback:** When any account triggers either type of cooldown, the pending query is instantly retried on the next available account without failing the agent's task.
- **Smart Recovery Prioritization:** If all accounts happen to be in cooldown, the engine prioritizes short-burst accounts over daily-exhausted accounts, picking the one nearest recovery.
- **Direct Pro Routing:** Include phrases like `"use pro"`, `"pro account"`, or pass `use_pro=True` to route directly to your designated Pro AI account.
- **Lazy Auto-Sharing Cache:** If an account needs to query a notebook owned by another account, Super-NLM invites the query account as an editor behind the scenes and caches the permission in-memory.
- **Zero-Quota Catalog Exploration:** Notebook and profile listings are served directly from the local cache without consuming any Google API quota.

### Available MCP Tools

| Tool | Parameters | Description |
|---|---|---|
| `query_notebook` | `notebook_id`, `query`, `conversation_id?`, `source_ids?`, `timeout?`, `new_conversation?`, `use_pro?` | Main query tool with automatic multi-account rotation, rate-limit fallback, and optional Pro AI bypass. |
| `list_notebooks` | `search?`, `profile_id?`, `category?` | Search and list notebooks across all accounts from cache (**0 quota used**). Supports category filtering (`study`, `projects`, `all`). |
| `list_profiles` | *none* | List all registered accounts, connection statuses, tiers, badge colors, and emails. |
| `sync_notebooks` | *none* | Force a complete background refresh of notebooks across all Google accounts from Google NotebookLM. |
| `cross_query` | `notebook_ids[]`, `query`, `synthesizer_profile_id?` | Parallel query across multiple notebooks with Pro AI synthesis. |
| `rotation_status` | *none* | Real-time diagnostics: global query count, active cooldown timers, and per-account stats. |

### MCP Client Setup

Add Super-NLM to your MCP client configuration (e.g. `mcp_config.json` in Antigravity, Claude Desktop, or Claude Code):

```json
{
  "mcpServers": {
    "super-nlm": {
      "command": "F:\\Aaradhya-Dev-Tamrakar\\super-nlm\\.venv\\Scripts\\python.exe",
      "args": [
        "-m",
        "mcp_server"
      ],
      "env": {
        "PYTHONUNBUFFERED": "1"
      }
    }
  }
}
```

Or run directly from the terminal via the installed console script:
```powershell
.venv\Scripts\super-nlm-mcp.exe
```

---

## 🛠️ Quick Start

### 1. Launch Locally
Run the launcher script:
```powershell
# Double-click launch.bat or run via PowerShell:
.\launch.ps1
```
Or directly via Python:
```powershell
.venv\Scripts\python run.py
```
This starts the backend on `http://127.0.0.1:8000` (automatically increments port if occupied) and opens your default browser.

---

## ⌨️ Keyboard Shortcuts

Press `?` anywhere in the app to view the interactive shortcut reference dialog:

| Shortcut | Action |
|---|---|
| `/` or `Ctrl + K` | Focus Global Search Bar |
| `s` or `r` | Sync All Notebooks across all accounts |
| `a` | Open Google Accounts Manager modal |
| `c` | Open Multi-Notebook Cross-Synthesis modal |
| `?` | Toggle Keyboard Shortcuts cheat-sheet |
| `Esc` | Close active dialog or modal |

---

## 🌍 Access From Anywhere (Phone, Tablet, Laptop)

You don't have to keep this restricted to your local desk. Choose between two remote access methods:

### Option A: Cloudflare Quick Tunnel (Instant HTTPS Link Anywhere)
* Zero configuration, no apps needed on your phone or laptop.
* Provides a secure public HTTPS link (e.g. `https://random-words.trycloudflare.com`).
* **Automatically copies the URL to your Windows clipboard** and displays an **ASCII QR code** directly in the terminal for instant mobile phone scanning.
* **Run:**
  ```powershell
  # Double-click launch_remote.bat or run:
  .venv\Scripts\python run.py --tunnel
  ```

### Option B: Tailscale (Private Encrypted Mesh)
* 100% private to your devices, zero public internet exposure.
* Direct peer-to-peer connection with ultra-low latency.
* **Setup:**
  ```powershell
  powershell -ExecutionPolicy Bypass -File setup_tailscale.ps1
  ```
  Install the Tailscale app on your phone/laptop, and navigate to `http://<your-pc-name>:8000`.

---

## ☁️ 24/7 Hosting on Google Cloud Run ($0 / Free)

If you don't want to keep your PC powered on, deploy Super-NLM directly to **Google Cloud Run**:
* **Cost:** $0 (fits entirely within Google Cloud's permanent free tier of 2M requests/month).
* **Speed:** Hosted directly on Google's infrastructure for ultra-low latency to Gemini Notebook.
* **Deploy in 1 Click:**
  ```powershell
  # Double-click deploy_cloud_run.bat or run:
  powershell -ExecutionPolicy Bypass -File deploy_cloud_run.ps1
  ```
  It automatically containerizes and deploys your hub, outputting a permanent HTTPS URL like `https://super-nlm-xxxx.a.run.app` that you can bookmark on mobile or desktop 24/7.

---

## 🔄 Repository Synchronization (`sync.ps1` & `sync.bat`)

Super-NLM includes a specialized automation engine for Git synchronization, secret protection, and conventional commits:

```powershell
# Routine sync: pull updates, stage, auto-commit with conventional message, and push
.\sync.ps1

# Custom commit message
.\sync.ps1 -m "feat(rotator): add intelligent quota backoff"

# Switch or target a specific branch
.\sync.ps1 -Branch feature-name

# Dry-run mode: preview staged changes, secret scan, and auto-generated commit message
.\sync.ps1 -WhatIf

# Telemetry: check ahead/behind commits and working tree status
.\sync.ps1 -Status

# Pull only (rebase + autostash) without committing or pushing
.\sync.ps1 -PullOnly

# Push existing commits only
.\sync.ps1 -PushOnly

# Commit locally without pushing
.\sync.ps1 -NoPush

# Synchronize Git and trigger background notebook refresh on running Hub
.\sync.ps1 -SyncNotebooks

# Run test suites before committing
.\sync.ps1 -Test
```

### Automation Guardrails:
1. **Pre-Commit Secret Scanner:** Prevents accidental commits of API keys (Gemini `AIza`, OpenAI `sk-`, Anthropic, GitHub PATs, AWS, private keys).
2. **Contextual Conventional Commits:** Scopes commits automatically to affected components (`rotator`, `nlm`, `mcp`, `ui`, `backend`, `storage`, `tunnel`, `tests`, `docs`, `scripts`).
3. **Rebase Conflict Recovery:** Retries rejected pushes by automatically rebasing with `--autostash`.

---

## 👥 Managing Multiple Accounts

1. Click **Accounts** (`a`) in the top navigation.
2. Under **Connected Google Accounts**:
   - View connection health, Google emails, tiers, and badge colors.
   - Click **Edit** on any account card to modify its display label, email, tier (`Standard` vs `Pro AI`), badge color (presets or custom hex), or set it as the **Default Pro AI Engine**.
   - Click **Re-login** if a Google session token has expired.
   - Click **Remove** to unlink an account.
3. Under **Connect Another Google Account**:
   - Enter a profile key (e.g. `work`, `college`, `school`, `business`).
   - Enter a display label (e.g. `Work / Acme Corp`, `College Classes`).
   - Select the account tier (`Standard` or `Pro AI`).
   - Choose a badge color.
   - Click **Add & Connect Account**.
4. A Google sign-in window will open in Chrome. Log in with that account.
5. Once completed, your profile session is saved permanently, and its notebooks appear in the unified hub!

---

## 📁 Architecture

- **MCP Server (`mcp_server/`):**
  - `server.py`: MCPServer instance running over standard I/O (stdio) transport for agent tool calls.
  - `rotator.py`: Thread-safe `AccountRotator` managing atomic query counting, 120s burst / daily midnight quota cooldowns, and auto-sharing.
  - `tools.py`: Tool declarations for `query_notebook`, `list_notebooks`, `list_profiles`, `sync_notebooks`, `cross_query`, and `rotation_status`.
- **Backend (`backend/`):**
  - `app.py`: FastAPI server serving endpoints for profiles, cached notebooks, sync, quick chat, rotated queries, study filtering, and cross-account synthesis.
  - `nlm_client.py`: Async subprocess execution layer wrapping Google's `nlm` CLI with multi-profile isolation.
  - `storage.py`: Thread-safe persistence for `profiles.json` and `notebooks_cache.json`.
  - `tunnel.py`: Ephemeral Cloudflare Quick Tunnel orchestration, clipboard integration, and terminal ASCII QR code generator.
  - `models.py`: Pydantic data schemas and course/study pattern classification engine (`detect_course_info`).
  - `config.py`: Environment configuration, Pro account routing, and Gemini synthesis models.
- **Frontend (`frontend/`):**
  - `index.html`: Responsive, dark-mode single-page interface styled with Tailwind CSS and custom glassmorphism.
  - `app.js`: Reactive event handling, search filtering, study tabs, account editor form, keyboard shortcuts, markdown rendering, and PDF export.
  - `style.css`: Custom animations, spatial glassmorphism, badge themes, and scrollbars.
- **Tests (`tests/`):**
  - `test_api.py`: Automated tests for profile management, editing, renaming, and notebook listing.
  - `test_study_filter.py`: Unit tests for course code extraction and study categorization.
  - `test_cross_synthesis.py`: Verification of multi-notebook synthesis workflow and error handling.
  - `test_shortcuts.py`: Automated tests for keyboard shortcuts and modal triggers.
  - `test_bugs_regression.py`: Regression test suite for quota failover, session pinning, and process stability.
  - `test_loading_states.py`: UI loading and synchronization indicator validation.
- **Scripts & Tools:**
  - `sync.ps1` / `sync.bat`: Unified Git synchronization, secret scanner, and auto-commit engine.
  - `launch.ps1` / `launch.bat`: Local desktop launcher with Dev Drive ReFS optimization.
  - `launch_remote.bat`: Remote launcher with automatic Cloudflare HTTPS tunneling.
  - `setup_tailscale.ps1`: Automated Tailscale mesh network configuration.
  - `deploy_cloud_run.ps1` / `deploy_cloud_run.bat`: 1-click Google Cloud Run deployment.
