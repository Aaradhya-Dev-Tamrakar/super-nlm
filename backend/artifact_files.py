"""Clean filenames with an ID catalog stored outside media folders.

Callers hold the destination lease while resolving names and writing files.
"""

import hashlib
import json
import re
import uuid
from pathlib import Path


def clean_title(value: str) -> str:
    value = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "_", value).strip(" .")[:90].rstrip(" .")
    if value.split(".", 1)[0].upper() in {
        "CON",
        "PRN",
        "AUX",
        "NUL",
        *(f"COM{i}" for i in range(1, 10)),
        *(f"LPT{i}" for i in range(1, 10)),
    }:
        value = "_" + value
    return value or "Untitled"


class ArtifactCatalog:
    def __init__(self, folder: Path, state_dir: Path):
        self.folder = folder.resolve()
        key = hashlib.sha256(str(self.folder).casefold().encode()).hexdigest()
        self.path = state_dir / "artifact_indexes" / f"{key}.json"
        self.entries = (
            json.loads(self.path.read_text(encoding="utf-8"))
            if self.path.exists()
            else {}
        )

    def prepare(self, artifact_id, title, extension, known_path=None):
        artifact_id = str(uuid.UUID(artifact_id))
        previous = self.entries.get(artifact_id)
        existing = None
        candidates = (
            [self.folder / previous]
            if previous and Path(previous).name == previous
            else []
        )
        if known_path:
            known = Path(known_path).resolve()
            if known.parent == self.folder:
                candidates.append(known)
        candidates.extend(self.folder.glob(f"*_{artifact_id}{extension}"))
        existing = next(
            (p for p in candidates if p.is_file() and p.stat().st_size), None
        )
        if previous and Path(previous).name == previous:
            output = self.folder / previous
        else:
            stem = clean_title(title)
            if stem.lower().endswith(extension.lower()):
                stem = stem[: -len(extension)] or "Untitled"
            output = self.folder / f"{stem}{extension}"
            reserved = {
                name.casefold()
                for aid, name in self.entries.items()
                if aid != artifact_id
            }
            occupied = {
                p.name.casefold() for p in self.folder.iterdir() if p != existing
            }
            count = 0
            while (
                output.name.casefold() in reserved or output.name.casefold() in occupied
            ):
                suffix = artifact_id[:8] + (f"-{count}" if count else "")
                output = self.folder / f"{stem} [{suffix}]{extension}"
                count += 1
        if existing and existing != output:
            # Never replace another file during migration.
            if output.exists():
                raise ValueError(
                    f"Cannot rename existing artifact without replacing {output.name}"
                )
            existing.rename(output)
            existing = output
        self.entries[artifact_id] = output.name
        self.path.parent.mkdir(parents=True, exist_ok=True)
        temporary = self.path.with_suffix(".tmp")
        temporary.write_text(
            json.dumps(self.entries, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        temporary.replace(self.path)
        return output, existing
