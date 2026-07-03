from __future__ import annotations

import hashlib
from dataclasses import dataclass
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from db.models import PullRequest, Repository
from db.repositories import (
    mark_webhook_delivery_processed,
    match_hunk_to_code_chunks,
    queue_baseline_index_job,
    record_webhook_delivery,
    upsert_code_chunk,
    upsert_commit,
    upsert_pull_request,
    upsert_pull_request_changed_file,
    upsert_pull_request_hunk,
    upsert_repository,
)
from integrations.github_client import GitHubClientProtocol
from integrations.github_patches import parse_patch_hunks


SUPPORTED_PULL_REQUEST_ACTIONS = {"opened", "synchronize", "reopened"}


@dataclass(frozen=True)
class GitHubRepositoryPayload:
    owner: str
    name: str
    github_repository_id: str | None
    html_url: str | None
    default_branch: str


@dataclass(frozen=True)
class GitHubChangedFilePayload:
    path: str
    status: str
    sha: str | None
    additions: int
    deletions: int
    changes: int
    patch: str
    previous_filename: str | None


def parse_installation_repositories(payload: dict[str, Any]) -> list[GitHubRepositoryPayload]:
    return [_parse_repository(raw) for raw in payload.get("repositories", [])]


def parse_repository_payload(payload: dict[str, Any]) -> GitHubRepositoryPayload:
    return _parse_repository(payload["repository"])


def parse_changed_file(payload: dict[str, Any]) -> GitHubChangedFilePayload:
    return GitHubChangedFilePayload(
        path=str(payload.get("filename", "")),
        status=str(payload.get("status", "modified")),
        sha=str(payload["sha"]) if payload.get("sha") is not None else None,
        additions=int(payload.get("additions", 0) or 0),
        deletions=int(payload.get("deletions", 0) or 0),
        changes=int(payload.get("changes", 0) or 0),
        patch=str(payload.get("patch", "") or ""),
        previous_filename=payload.get("previous_filename"),
    )


async def process_github_webhook(
    session: AsyncSession,
    *,
    event: str,
    delivery_id: str,
    payload: dict[str, Any],
    raw_body: bytes,
    github_client: GitHubClientProtocol | None = None,
) -> dict[str, Any]:
    action = payload.get("action")
    payload_hash = hashlib.sha256(raw_body).hexdigest()
    delivery, is_new = await record_webhook_delivery(
        session,
        delivery_id=delivery_id,
        event=event,
        action=str(action) if action is not None else None,
        payload_hash=payload_hash,
    )
    if not is_new:
        return {"status": "duplicate", "delivery_id": delivery_id}

    try:
        if event == "installation":
            result = await _process_installation_event(session, payload)
        elif event == "push":
            result = await _process_push_event(session, payload)
        elif event == "pull_request":
            if github_client is None:
                # Do NOT silently fall back to an empty mock: in production that
                # records the PR with zero files and masquerades as success.
                # Surface it as unsynced so the caller/logs can act on it.
                result = {
                    "event": "pull_request",
                    "action": payload.get("action"),
                    "synced": False,
                    "reason": "github_client_unavailable",
                    "files": 0,
                    "hunks": 0,
                }
            else:
                result = await _process_pull_request_event(
                    session,
                    payload,
                    github_client=github_client,
                )
        else:
            result = {"status": "ignored", "event": event}

        await mark_webhook_delivery_processed(session, delivery, status="processed")
        return result | {"status": "processed", "delivery_id": delivery_id}
    except Exception as exc:
        await mark_webhook_delivery_processed(session, delivery, status="failed", error=str(exc))
        raise


async def sync_pull_request_files(
    session: AsyncSession,
    *,
    repository: Repository,
    pr_number: int,
    base_sha: str,
    head_sha: str,
    state: str,
    files: list[dict[str, Any]],
) -> PullRequest:
    pull_request = await upsert_pull_request(
        session,
        repository_id=repository.id,
        number=pr_number,
        base_sha=base_sha,
        head_sha=head_sha,
        state=state,
    )

    for raw_file in files:
        parsed_file = parse_changed_file(raw_file)
        changed_file = await upsert_pull_request_changed_file(
            session,
            pull_request_id=pull_request.id,
            path=parsed_file.path,
            status=parsed_file.status,
            sha=parsed_file.sha,
            additions=parsed_file.additions,
            deletions=parsed_file.deletions,
            changes=parsed_file.changes,
            patch=parsed_file.patch,
            previous_filename=parsed_file.previous_filename,
        )
        for parsed_hunk in parse_patch_hunks(parsed_file.patch):
            hunk = await upsert_pull_request_hunk(
                session,
                changed_file_id=changed_file.id,
                path=parsed_file.path,
                hunk_index=parsed_hunk.hunk_index,
                header=parsed_hunk.header,
                old_start_line=parsed_hunk.old_start_line,
                old_end_line=parsed_hunk.old_end_line,
                new_start_line=parsed_hunk.new_start_line,
                new_end_line=parsed_hunk.new_end_line,
                patch=parsed_hunk.patch,
            )
            await match_hunk_to_code_chunks(
                session,
                repository_id=repository.id,
                commit_sha=base_sha,
                path=parsed_file.path,
                hunk_id=hunk.id,
                start_line=parsed_hunk.new_start_line,
                end_line=parsed_hunk.new_end_line,
            )

    await session.flush()
    return pull_request


async def index_repository_baseline(
    session: AsyncSession,
    *,
    repository: Repository,
    ref: str,
    commit_sha: str,
    github_client: GitHubClientProtocol,
) -> int:
    await upsert_commit(session, repository_id=repository.id, sha=commit_sha, ref=ref)
    indexed = 0
    for entry in await github_client.repository_tree(repository.github_owner, repository.github_name, ref):
        if entry.get("type") != "blob":
            continue
        path = str(entry.get("path", ""))
        if not path:
            continue
        source = await github_client.file_contents(repository.github_owner, repository.github_name, path, ref)
        if not source:
            continue
        line_count = max(1, len(source.splitlines()))
        await upsert_code_chunk(
            session,
            repository_id=repository.id,
            commit_sha=commit_sha,
            path=path,
            name=path.rsplit("/", 1)[-1],
            language=_language_for_path(path),
            start_line=1,
            end_line=line_count,
            source=source,
        )
        indexed += 1

    await session.flush()
    return indexed


async def _process_installation_event(session: AsyncSession, payload: dict[str, Any]) -> dict[str, Any]:
    action = payload.get("action")
    installation_id = str(payload.get("installation", {}).get("id", ""))
    repositories = parse_installation_repositories(payload)
    upserted = 0

    for repository_payload in repositories:
        repository = await upsert_repository(
            session,
            github_repository_id=repository_payload.github_repository_id,
            github_owner=repository_payload.owner,
            github_name=repository_payload.name,
            html_url=repository_payload.html_url,
            default_branch=repository_payload.default_branch,
            installation_id=installation_id or None,
            is_active=action != "deleted",
        )
        upserted += 1
        if action == "created":
            await queue_baseline_index_job(
                session,
                repository_id=repository.id,
                ref=repository.default_branch,
                reason="installation",
            )

    await session.flush()
    return {"event": "installation", "action": action, "repositories": upserted}


async def _process_push_event(session: AsyncSession, payload: dict[str, Any]) -> dict[str, Any]:
    repository_payload = parse_repository_payload(payload)
    repository = await upsert_repository(
        session,
        github_repository_id=repository_payload.github_repository_id,
        github_owner=repository_payload.owner,
        github_name=repository_payload.name,
        html_url=repository_payload.html_url,
        default_branch=repository_payload.default_branch,
        installation_id=_installation_id(payload),
    )
    after_sha = str(payload.get("after", "") or "")
    ref = str(payload.get("ref", repository.default_branch) or repository.default_branch)
    if after_sha:
        await upsert_commit(session, repository_id=repository.id, sha=after_sha, ref=ref)
        await queue_baseline_index_job(
            session,
            repository_id=repository.id,
            ref=ref,
            commit_sha=after_sha,
            reason="push",
        )

    return {"event": "push", "repositories": 1, "baseline_jobs": 1 if after_sha else 0}


async def _process_pull_request_event(
    session: AsyncSession,
    payload: dict[str, Any],
    *,
    github_client: GitHubClientProtocol,
) -> dict[str, Any]:
    action = str(payload.get("action", ""))
    if action not in SUPPORTED_PULL_REQUEST_ACTIONS:
        return {"event": "pull_request", "action": action, "files": 0, "hunks": 0}

    repository_payload = parse_repository_payload(payload)
    repository = await upsert_repository(
        session,
        github_repository_id=repository_payload.github_repository_id,
        github_owner=repository_payload.owner,
        github_name=repository_payload.name,
        html_url=repository_payload.html_url,
        default_branch=repository_payload.default_branch,
        installation_id=_installation_id(payload),
    )
    pr = payload["pull_request"]
    pr_number = int(pr["number"])
    files = await github_client.pull_request_files(
        repository.github_owner,
        repository.github_name,
        pr_number,
    )
    pull_request = await sync_pull_request_files(
        session,
        repository=repository,
        pr_number=pr_number,
        base_sha=str(pr["base"]["sha"]),
        head_sha=str(pr["head"]["sha"]),
        state=str(pr.get("state", "open")),
        files=files,
    )
    hunk_count = sum(len(parse_patch_hunks(str(file.get("patch", "") or ""))) for file in files)

    return {
        "event": "pull_request",
        "action": action,
        "pull_request_id": pull_request.id,
        "files": len(files),
        "hunks": hunk_count,
    }


def _parse_repository(raw: dict[str, Any]) -> GitHubRepositoryPayload:
    full_name = str(raw.get("full_name") or "")
    if "/" in full_name:
        owner, name = full_name.split("/", 1)
    else:
        owner = str(raw.get("owner", {}).get("login", ""))
        name = str(raw.get("name", ""))

    return GitHubRepositoryPayload(
        owner=owner,
        name=name,
        github_repository_id=str(raw["id"]) if raw.get("id") is not None else None,
        html_url=raw.get("html_url"),
        default_branch=str(raw.get("default_branch", "main") or "main"),
    )


def _installation_id(payload: dict[str, Any]) -> str | None:
    raw = payload.get("installation", {}).get("id")
    return str(raw) if raw is not None else None


def _language_for_path(path: str) -> str:
    suffix = path.rsplit(".", 1)[-1].lower() if "." in path else ""
    if suffix in {"cbl", "cob", "cobol"}:
        return "cobol"
    if suffix == "java":
        return "java"
    if suffix == "sql":
        return "sql"
    if suffix == "py":
        return "python"
    return "unknown"
