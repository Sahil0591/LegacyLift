"""
core/layer0_5/doc_fetcher.py — Target language documentation fetcher.

Layer 0.5 runs after archaeology and before migration.  Its job is to build
a profile of the TARGET language so the LLM migration prompts can reference
up-to-date API information rather than relying on training data.

doc_fetcher.py handles the first step: fetching documentation for the target
language's standard library and any key third-party libraries we'll use in
the migration (for example exact-decimal, date/time, and test libraries).

Uses aiohttp for async fetching.  In DEMO_MODE (or when URLs are not
configured) it returns canned stub data so the pipeline doesn't need internet
access during development.

Pipeline position: First step of Layer 0.5.
WebSocket events: 'docs_fetching' (per URL), 'docs_fetched' (on completion).
"""

from __future__ import annotations

import os
from datetime import datetime, timezone
from typing import Any

import aiohttp
from rich.console import Console

from core.target_languages import get_target_language

console = Console()
DEMO_MODE = os.getenv("DEMO_MODE", "true").lower() == "true"

# ---------------------------------------------------------------------------
# Documentation URL registry
# ---------------------------------------------------------------------------

# Maps target language name to documentation endpoints to fetch when real
# network-backed docs are enabled. Empty lists intentionally fall back to the
# canonical target-language metadata.
DOC_URLS: dict[str, list[str]] = {
    "Python": [
        # TODO (implementer): replace with real Python docs API endpoints.
        # Python 3.12 stdlib index: https://docs.python.org/3.12/py-modindex.html
        # For the hackathon, we don't actually fetch — just return stubs.
    ],
    "Java": [
        # TODO: Java 21 API docs
    ],
    "Go": [
        # TODO: pkg.go.dev API
    ],
    "C#": [],
    "C++": [],
    "Rust": [],
    "SQL": [],
    "TypeScript": [],
}


class DocFetcher:
    """
    Fetches and caches documentation for the target language.

    Results are cached in memory for the lifetime of the application to
    avoid hammering documentation servers during repeated demo runs.
    """

    _cache: dict[str, dict] = {}

    async def fetch(self, target_language: str) -> dict[str, Any]:
        """
        Fetch documentation for the given target language.

        Args:
            target_language: Language name, e.g. 'Python', 'Java'.

        Returns:
            Dict with keys:
              - version:   str  (e.g. '3.12')
              - modules:   list[str]  (standard library module names)
              - libraries: list[str]  (recommended third-party libraries)
              - fetched_at: str (ISO timestamp)

        TODO (implementer):
          - Use aiohttp.ClientSession to fetch DOC_URLS[target_language].
          - Parse the response (HTML or JSON) to extract module/class names.
          - Emit 'docs_fetching' WebSocket event before each URL fetch.
          - Emit 'docs_fetched' WebSocket event on completion.
          - Cache the result so subsequent pipeline runs are fast.
          - Add a TTL to the cache (docs don't change often but do change).
        """
        target = get_target_language(target_language)
        cache_key = target.id
        if cache_key in self._cache:
            if DEMO_MODE:
                console.print(f"[dim]DocFetcher: cache hit for {target_language}[/dim]")
            return self._cache[cache_key]

        if DEMO_MODE:
            console.print(
                f"[dim]DocFetcher.fetch({target_language}) → returning stub docs[/dim]"
            )
            result = self._stub_docs(target_language)
            self._cache[cache_key] = result
            return result

        # Real fetch path (only runs when DEMO_MODE=false and URLs are configured)
        urls = DOC_URLS.get(target.language, [])
        result = {
            "version":    target.version,
            "modules":    [],
            "libraries":  list(target.recommended_libraries),
            "fetched_at": datetime.now(timezone.utc).isoformat(),
        }

        async with aiohttp.ClientSession() as session:
            for url in urls:
                try:
                    console.print(f"[dim]DocFetcher: fetching {url}[/dim]")
                    async with session.get(url, timeout=aiohttp.ClientTimeout(total=10)) as resp:
                        if resp.status == 200:
                            # TODO (implementer): parse response into module list
                            pass
                except Exception as exc:
                    console.print(f"[yellow]DocFetcher: failed to fetch {url}: {exc}[/yellow]")

        self._cache[cache_key] = result
        return result

    def _stub_docs(self, language: str) -> dict[str, Any]:
        """
        Return canned documentation metadata for DEMO_MODE.

        TODO (implementer): remove once real fetching is implemented.
        """
        target = get_target_language(language)
        if target.id == "python-3x":
            return {
                "version":   "3.12",
                "modules":   [
                    "decimal", "datetime", "collections", "itertools",
                    "functools", "pathlib", "logging", "dataclasses", "enum",
                    "typing", "re", "struct", "io",
                ],
                "libraries": list(target.recommended_libraries),
                "fetched_at": datetime.now(timezone.utc).isoformat(),
            }

        return {
            "version":   target.version,
            "modules":   list(target.recommended_libraries),
            "libraries": list(target.recommended_libraries),
            "fetched_at": datetime.now(timezone.utc).isoformat(),
        }
