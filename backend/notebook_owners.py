"""Resolve owner badges from live collaborator roles, never account ordering."""

import asyncio
import json
import logging

from backend.nlm_client import run_nlm_cmd


async def enrich_notebook_owners(notebooks, cached=()):
    owners = {n.id: n.ownerEmail for n in cached if n.ownerEmail}
    shares = {
        n.id: n.sharedWith for n in cached if getattr(n, "sharedWith", None) is not None
    }
    groups = {}
    for notebook in notebooks:
        groups.setdefault(notebook.id, []).append(notebook)
    semaphore = asyncio.Semaphore(3)

    async def resolve(notebook_id, entries):
        async with semaphore:
            profile = next(
                (n.profileId for n in entries if n.profileId == "default"),
                entries[0].profileId,
            )
            result = await run_nlm_cmd(
                ["share", "status", notebook_id, "--profile", profile, "--json"],
                timeout=20,
            )
            if result.get("success"):
                try:
                    data = json.loads(result.get("stdout", ""))
                    collaborators = data.get("collaborators")
                    if not isinstance(collaborators, list):
                        raise TypeError("Missing collaborator metadata")
                    shares[notebook_id] = list(
                        {
                            c["email"].casefold(): c
                            for c in collaborators
                            if c.get("email") and c.get("role") != "owner"
                        }.values()
                    )
                    owner = next(
                        (
                            c.get("email")
                            for c in data.get("collaborators", [])
                            if c.get("role") == "owner" and c.get("email")
                        ),
                        None,
                    )
                    if owner:
                        owners[notebook_id] = owner
                except (ValueError, AttributeError, TypeError):
                    logging.getLogger(__name__).warning(
                        "Invalid owner metadata for notebook %s", notebook_id
                    )
            for notebook in entries:
                notebook.ownerEmail = owners.get(notebook_id)
                notebook.sharedWith = shares.get(notebook_id)

    await asyncio.gather(*(resolve(nid, entries) for nid, entries in groups.items()))
    return notebooks
