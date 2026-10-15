---
name: super-nlm-downloads
description: This skill should be used when the user pastes a Google NotebookLM link or notebook ID to download all studio artifacts (videos, quizzes, mind maps, slides, reports), requires files saved directly to the subject's downloads folder outside the repository, or asks to share downloaded folders/files via LocalSend (sharing the whole folder, or bundling files into a date-appended subfolder).
version: 1.1.0
---

# Super-NLM Studio Artifact Downloads & LocalSend Sharing Skill

This skill governs the automated downloading of Google NotebookLM Studio artifacts into dedicated external subject folders and seamless P2P sharing via LocalSend.

---

### Fleet downloads through MCP

`download_mode="auto"` starts at one transfer and probes up to six using completed transfer windows (bytes / elapsed time, including CLI/server overhead). It backs off after failures or absent throughput gains, ignores tiny/incomplete samples for tuning, and shows observed MiB/s plus concurrency. This is a heuristic, not an internet line-speed test. Manual concurrency remains available. Paused batches can select Auto on resume.

Notebooks download sequentially in input order. `artifact_concurrency` controls simultaneous artifacts within the current notebook (1-6, default 1 for slow connections). The GUI offers sequential or parallel modes; a paused batch can change concurrency when resumed.

Clean filenames use the artifact title and extension (for example `Evolution of Context.mp4`). Add a short ID suffix only for name collisions; keep full IDs in the local catalog and batch manifests. Recognize and safely rename legacy type/title/UUID filenames without re-downloading. The scheduler also uses the actual artifact title when available.

Downloads always use the `default` account; generation retains fleet rotation. The download CLI has no `--profile` option: set `NLM_PROFILE=default` only in the child process environment, removing inherited `NOTEBOOKLM_COOKIES`. Never switch the saved CLI default for each download.


For mass generation/download, use the Hub Fleet batch GUI or Super-NLM MCP. Paste many notebook URLs/UUIDs, select all supported artifact types or filter by type, preview notebook-specific folders, and set an external output root. MCP: `batch_download_artifacts`; inspect using `get_download_batch` / `list_download_batches`; use `resume_download_batch` after interruption. Resume does not regenerate Studio artifacts. Outputs are stored on the Super-NLM host and include a batch manifest. Use this workflow when managing a large fleet; keep the script below for one-notebook downloads and authorized LocalSend sharing.

## ⚡ Core Operational Principles

1. **Zero Repository Pollution**:
   - Studio artifact media (videos `.mp4`, slide decks `.pdf`/`.pptx`, quizzes `.md`, mind maps `.json`) must **NEVER be saved or committed inside the active git repository** (e.g. `super-nlm` or workspace root).
   - All files must be saved directly to the subject's downloads folder under:
     `$env:USERPROFILE\Downloads\<SubjectFolder>` (e.g. `$env:USERPROFILE\Downloads\EX725 Exam`).

2. **Automated URL & Subject Resolution**:
   - Extract the notebook UUID from any Google NotebookLM link:
     `https://notebook.google.com/notebook/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})`
   - Retrieve the notebook title and identify the course or subject code (e.g. `EX725`, `ME708`, `CT653`, `CT704`, `EX751`, `EX752`).
   - Map to the canonical subject directory:
     | Course Code | Canonical Subject Directory |
     | :--- | :--- |
     | **EX725** | `$env:USERPROFILE\Downloads\EX725 Exam` |
     | **ME708** | `$env:USERPROFILE\Downloads\ME708 Exam` |
     | **CT653** | `$env:USERPROFILE\Downloads\CT653 Exam` |
     | **CT704** | `$env:USERPROFILE\Downloads\CT704 Exam` |
     | **EX751** | `$env:USERPROFILE\Downloads\EX751 Exam` |
     | **EX752** | `$env:USERPROFILE\Downloads\EX752 Exam` |
     | *Other* | `$env:USERPROFILE\Downloads\<SanitizedTitle>` |

3. **Deterministic LocalSend Sharing Modes**:
   - **Mode A: Share Whole Folder**:
     - When instructed to "share folder", "share everything", or "send to [Device]", send the entire subject directory (`$env:USERPROFILE\Downloads\<SubjectFolder>`).
     - LocalSend automatically preserves the relative directory hierarchy (e.g. `EX725 Exam/Chapter 1_ ...`).
   - **Mode B: Share Files Only**:
     - When asked to "share files only", "share the files", or send a filtered subset of artifacts:
       1. Compute today's date formatted as `YYYY-MM-DD` (e.g. `2026-10-02`).
       2. Create a dedicated date-appended subfolder inside the subject directory:
          `$env:USERPROFILE\Downloads\<SubjectFolder>\<SubfolderName>_<YYYY-MM-DD>`
          *(e.g. `$env:USERPROFILE\Downloads\EX725 Exam\EX725_2026-10-02`)*
       3. Copy the selected/requested files into that subfolder.
       4. Dispatch that newly created dated folder via LocalSend.

---

## 🛠️ Automated Execution Workflow

### Single-notebook companion script

The skill bundles an automated script at `scripts/download_and_share.mjs` that executes the full pipeline end-to-end:

```powershell
# 1. Download all artifacts from URL directly to subject downloads folder:
node f:\Aaradhya-Dev-Tamrakar\super-nlm\.agents\skills\super-nlm-downloads\scripts\download_and_share.mjs "https://notebook.google.com/notebook/<notebook-uuid>"

# 2. Download and share the entire subject folder to V2029:
node f:\Aaradhya-Dev-Tamrakar\super-nlm\.agents\skills\super-nlm-downloads\scripts\download_and_share.mjs "https://notebook.google.com/notebook/<notebook-uuid>" --share --to "V2029"

# 3. Share the existing folder only (without re-downloading):
node f:\Aaradhya-Dev-Tamrakar\super-nlm\.agents\skills\super-nlm-downloads\scripts\download_and_share.mjs "<notebook-uuid>" --share-only --to "V2029"

# 4. Share files only (automatically creates <Folder>_YYYY-MM-DD subfolder and shares):
node f:\Aaradhya-Dev-Tamrakar\super-nlm\.agents\skills\super-nlm-downloads\scripts\download_and_share.mjs "<notebook-uuid>" --files-only --to "V2029"

# 5. Share files only with keyword filter:
node f:\Aaradhya-Dev-Tamrakar\super-nlm\.agents\skills\super-nlm-downloads\scripts\download_and_share.mjs "<notebook-uuid>" --files-only --filter "Chapter" --to "V2029"
```

---

### Option 2: Step-by-Step CLI Execution

If executing step-by-step manually:

#### Step 1: Identify Notebook & Resolve Path
```powershell
nlm notebook get <notebook_id> --json
# Read title -> Map to $env:USERPROFILE\Downloads\<Subject> Exam
```

#### Step 2: Download Outside Repository
```powershell
# Stage outside repo in a temporary staging folder
$staging = "$env:USERPROFILE\Downloads\_nlm_staging_$([guid]::NewGuid().ToString().Substring(0,8))"
nlm download all <notebook_id> --output-dir "$staging" --skip-existing --interactive-format markdown

# Move all files into the subject folder
$dest = "$env:USERPROFILE\Downloads\<Subject> Exam"
Get-ChildItem -Path "$staging" -Recurse -File | Move-Item -Destination "$dest" -Force
Remove-Item -Path "$staging" -Recurse -Force
```

#### Step 3: LocalSend Sharing via `localsend-mcp`

Use `F:\Aaradhya-Dev-Tamrakar\Utility-MCPs\localsend-mcp` client:

- **For Whole Folder**:
  ```javascript
  const payloads = collectPayloads(['C:\\Users\\Aaradhya\\Downloads\\<Subject> Exam']);
  await sendFiles(config, { peer, payloads });
  ```

- **For Files Only (Dated Subfolder)**:
  ```javascript
  const dateStr = new Date().toISOString().slice(0, 10);
  const subfolder = path.join('C:\\Users\\Aaradhya\\Downloads\\<Subject> Exam', `<Subject>_${dateStr}`);
  fs.mkdirSync(subfolder, { recursive: true });
  // Copy files to subfolder
  for (const f of selectedFiles) {
    fs.copyFileSync(path.join(sourceDir, f), path.join(subfolder, f));
  }
  const payloads = collectPayloads([subfolder]);
  await sendFiles(config, { peer, payloads });
  ```

---

## 🔒 Verification & Safety Gates

1. **Repo Cleanliness Check**:
   Immediately run `git status --short` after downloads to verify no files were placed in the repo working tree.
2. **LocalSend Peer Reachability**:
   Confirm the target device (e.g. `V2029`) is discovered on LAN before dispatching file transfers.
