# Super-NLM Hub 🚀
> **Multi-Account Unified Dashboard for Google NotebookLM**  
> Access, search, chat, and synthesize across $N$ Google accounts simultaneously.

---

## 🌟 Key Features

- **$N$-Account Architecture:** Add, edit, test, and delete an arbitrary number of Google accounts (Personal, Work, College, School, Business, etc.).
- **Pro AI Engine Routing:** `aaradhyadevtmr@gmail.com` is automatically set as the primary **Pro AI** engine for heavy workloads, high rate limits, and multi-notebook synthesis.
- **Unified Notebook Explorer:** Parallel fetching aggregates all your notebooks from every account into a single searchable dashboard.
- **Global Fast Search (`Ctrl+K`):** Instantly filter notebooks across all accounts by title, owner, or sources.
- **In-App Quick Chat:** Ask questions directly to any notebook without switching Google accounts or opening browser tabs.
- **Cross-Account Synthesis:** Select 2 or more notebooks across different accounts and synthesize them using your Pro AI model.
- **Direct Deep Links:** Jump straight to any notebook in Google's official NotebookLM web interface.

---

## 🛠️ Quick Start

### 1. Launch Locally
Run the launcher script:
```powershell
# Double click launch.bat or run:
.venv\Scripts\python run.py
```
This starts the backend on `http://127.0.0.1:8001` and opens your browser.

---

## 🌍 Access From Anywhere (Phone, Tablet, Laptop)

You don't have to keep this restricted to your local desk. Choose between two remote access methods:

### Option A: Cloudflare Tunnel (Instant HTTPS Link Anywhere)
* Zero configuration, no apps needed on your phone or laptop.
* Provides a secure public HTTPS link (e.g. `https://random-words.trycloudflare.com`).
* **Run:**
  ```powershell
  # Double click launch_remote.bat or run:
  .venv\Scripts\python run.py --tunnel
  ```
  The terminal will print your public link. Open it on any device anywhere in the world!

### Option B: Tailscale (Private Encrypted Mesh)
* 100% private to your devices, zero public internet exposure.
* Direct peer-to-peer connection with ultra-low latency.
* **Setup:**
  ```powershell
  powershell -ExecutionPolicy Bypass -File setup_tailscale.ps1
  ```
  Install the Tailscale app on your phone/laptop, and navigate to `http://<your-pc-name>:8001`.

---

## ☁️ 24/7 Hosting on Google Cloud Run ($0 / Free)

If you don't want to keep your laptop powered on, deploy Super-NLM directly to **Google Cloud Run**:
* **Cost:** $0 (fits entirely within Google Cloud's permanent free tier of 2M requests/mo).
* **Speed:** Hosted directly on Google's infrastructure for ultra-low latency to NotebookLM.
* **Deploy in 1 Click:**
  ```powershell
  # Double click deploy_cloud_run.bat or run:
  powershell -ExecutionPolicy Bypass -File deploy_cloud_run.ps1
  ```
  It automatically containerizes and deploys your hub, outputting a permanent HTTPS URL like `https://super-nlm-xxxx.a.run.app` that you can open on Android 24/7!

---

## 👥 Managing Multiple Accounts

1. Click **Accounts** in the top navigation.
2. Under **Connect Another Google Account**:
   - Enter a profile key (e.g. `work`, `college`, `school`, `business`).
   - Enter a display label (e.g. `Work / Acme Corp`, `College Classes`).
   - Select the account tier (`Standard` or `Pro AI`).
   - Choose a badge color.
   - Click **Add & Connect Account**.
3. A Google sign-in window will open in Chrome. Log in with that account.
4. Once completed, your profile session is saved permanently, and its notebooks appear in the unified hub!

---

## 📁 Architecture

- **Backend (`backend/`):**
  - `app.py`: FastAPI server serving endpoints for profiles, cached notebooks, sync, queries, and cross-account synthesis.
  - `nlm_client.py`: Async subprocess execution layer wrapping Google's `nlm` CLI with multi-profile isolation.
  - `storage.py`: Thread-safe persistence for `profiles.json` and `notebooks_cache.json`.
  - `config.py`: Configuration and default Pro account initialization.
- **Frontend (`frontend/`):**
  - `index.html`: Responsive, dark-mode single-page interface styled with Tailwind CSS.
  - `app.js`: Reactive event handling, search filtering, modals, and API communication.
  - `style.css`: Custom animations, glassmorphism, and scrollbars.
