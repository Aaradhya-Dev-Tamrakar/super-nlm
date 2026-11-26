"""Modular NotebookLM CLI integration package."""

from backend.nlm.process import (
    CREATE_NO_WINDOW,
    _bind_to_nlm_job,
    _exec_subprocess,
    _get_nlm_job_object,
    _resolve_nlm_python,
    _run_subprocess_sync,
    run_nlm_cmd,
)
from backend.nlm.profiles import (
    _is_missing_profile_error,
    check_profile_auth_status,
    delete_cli_profile,
    fetch_all_notebooks_concurrently,
    fetch_notebooks_for_profile,
    get_cli_profiles,
    launch_cli_login,
    rename_cli_profile,
)
from backend.nlm.query import (
    classify_quota_error,
    is_rate_limit_or_quota_error,
    query_notebook,
    query_notebook_with_pro_fallback,
    synthesize_cross_notebook,
    synthesize_with_gemini,
)
from backend.nlm.sharing import (
    SHARE_ROLE_REMOVE,
    auto_share_study_notebooks,
    batch_share_notebooks_to_accounts,
    check_or_share_with_pro,
    ensure_notebook_shared,
    remove_notebook_collaborator,
    unshare_account_from_fleet,
)
from backend.nlm.studio import (
    create_studio_artifact,
    download_studio_artifact,
    get_studio_status,
)
from backend.nlm.usage import (
    fetch_fleet_usage,
    fetch_profile_usage,
)

__all__ = [
    "CREATE_NO_WINDOW",
    "SHARE_ROLE_REMOVE",
    "_bind_to_nlm_job",
    "_exec_subprocess",
    "_get_nlm_job_object",
    "_is_missing_profile_error",
    "_resolve_nlm_python",
    "_run_subprocess_sync",
    "auto_share_study_notebooks",
    "batch_share_notebooks_to_accounts",
    "check_or_share_with_pro",
    "check_profile_auth_status",
    "classify_quota_error",
    "create_studio_artifact",
    "delete_cli_profile",
    "download_studio_artifact",
    "ensure_notebook_shared",
    "fetch_all_notebooks_concurrently",
    "fetch_fleet_usage",
    "fetch_notebooks_for_profile",
    "fetch_profile_usage",
    "get_cli_profiles",
    "get_studio_status",
    "is_rate_limit_or_quota_error",
    "launch_cli_login",
    "query_notebook",
    "query_notebook_with_pro_fallback",
    "remove_notebook_collaborator",
    "rename_cli_profile",
    "run_nlm_cmd",
    "synthesize_cross_notebook",
    "synthesize_with_gemini",
    "unshare_account_from_fleet",
]
