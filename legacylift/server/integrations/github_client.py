from __future__ import annotations

from typing import Any, Protocol

import aiohttp


class GitHubClientProtocol(Protocol):
    async def repository_tree(self, owner: str, repo: str, ref: str) -> list[dict[str, Any]]:
        ...

    async def file_contents(self, owner: str, repo: str, path: str, ref: str) -> str:
        ...

    async def pull_request_files(self, owner: str, repo: str, pr_number: int) -> list[dict[str, Any]]:
        ...


class GitHubApiClient:
    def __init__(self, token: str, *, base_url: str = "https://api.github.com") -> None:
        self.token = token
        self.base_url = base_url.rstrip("/")

    async def _get_json(self, path: str, *, params: dict[str, Any] | None = None) -> Any:
        headers = {
            "Accept": "application/vnd.github+json",
            "Authorization": f"Bearer {self.token}",
            "X-GitHub-Api-Version": "2022-11-28",
        }
        async with aiohttp.ClientSession(headers=headers) as session:
            async with session.get(f"{self.base_url}{path}", params=params) as response:
                response.raise_for_status()
                return await response.json()

    async def repository_tree(self, owner: str, repo: str, ref: str) -> list[dict[str, Any]]:
        payload = await self._get_json(
            f"/repos/{owner}/{repo}/git/trees/{ref}",
            params={"recursive": "1"},
        )
        return list(payload.get("tree", []))

    async def file_contents(self, owner: str, repo: str, path: str, ref: str) -> str:
        payload = await self._get_json(
            f"/repos/{owner}/{repo}/contents/{path}",
            params={"ref": ref},
        )
        content = payload.get("content", "")
        encoding = payload.get("encoding", "")
        if encoding != "base64":
            return str(content)

        import base64

        return base64.b64decode(content).decode("utf-8", errors="replace")

    async def pull_request_files(self, owner: str, repo: str, pr_number: int) -> list[dict[str, Any]]:
        files: list[dict[str, Any]] = []
        page = 1
        while True:
            payload = await self._get_json(
                f"/repos/{owner}/{repo}/pulls/{pr_number}/files",
                params={"per_page": 100, "page": page},
            )
            page_files = list(payload)
            files.extend(page_files)
            if len(page_files) < 100:
                break
            page += 1
        return files


class MockGitHubClient:
    def __init__(
        self,
        *,
        tree: dict[tuple[str, str, str], list[dict[str, Any]]] | None = None,
        contents: dict[tuple[str, str, str, str], str] | None = None,
        changed_files: dict[tuple[str, str, int], list[dict[str, Any]]] | None = None,
    ) -> None:
        self.tree = tree or {}
        self.contents = contents or {}
        self.changed_files = changed_files or {}

    async def repository_tree(self, owner: str, repo: str, ref: str) -> list[dict[str, Any]]:
        return list(self.tree.get((owner, repo, ref), []))

    async def file_contents(self, owner: str, repo: str, path: str, ref: str) -> str:
        return self.contents.get((owner, repo, path, ref), "")

    async def pull_request_files(self, owner: str, repo: str, pr_number: int) -> list[dict[str, Any]]:
        return list(self.changed_files.get((owner, repo, pr_number), []))
