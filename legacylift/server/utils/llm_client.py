"""
utils/llm_client.py — Single LLM wrapper used by every pipeline layer.

All AI calls in LegacyLift go through this module. Centralising here means:
  - One place to swap models (gpt-4o → gpt-4o-mini → Claude) via env vars
  - Consistent retry / backoff behaviour across all layers
  - DEMO_MODE logging so you can audit every prompt during live demos
  - Easy to mock in tests (just patch llm_client.complete)

Usage (in any layer file):
    from utils.llm_client import LLMClient
    client = LLMClient()
    response = await client.complete(
        system="You are a COBOL expert.",
        user="Extract business rules from: ...",
    )

The client reads OPENAI_API_KEY, OPENAI_MODEL, and DEMO_MODE from the
environment (loaded by python-dotenv in main.py at startup).
"""

from __future__ import annotations

import asyncio
import os
import time
from typing import AsyncGenerator, Optional

from rich.console import Console
from rich.panel import Panel
from tenacity import (
    retry,
    stop_after_attempt,
    wait_exponential,
    retry_if_exception_type,
)

# ---------------------------------------------------------------------------
# Lazy OpenAI import so the rest of the pipeline loads even without the key
# ---------------------------------------------------------------------------
try:
    from openai import AsyncOpenAI, APIError, APIConnectionError, RateLimitError
    OPENAI_AVAILABLE = True
except ImportError:
    OPENAI_AVAILABLE = False

console = Console()

# ---------------------------------------------------------------------------
# Sentinel dummy response used when DEMO_MODE=true and no API key is set
# ---------------------------------------------------------------------------
DEMO_RESPONSE = (
    "[DEMO] This is a placeholder LLM response. "
    "Set OPENAI_API_KEY in .env to get real AI output."
)


class LLMClient:
    """
    Async wrapper around the OpenAI Chat Completions API.

    Supports:
      - Basic (non-streaming) completions
      - Streaming completions with async generator
      - Automatic retry with exponential backoff
      - DEMO_MODE console logging of every prompt and response
      - Model override per-call (useful for cheaper models in tests)
    """

    def __init__(self) -> None:
        self.api_key: str = os.getenv("OPENAI_API_KEY", "")
        self.model: str = os.getenv("OPENAI_MODEL", "gpt-4o")
        self.demo_mode: bool = os.getenv("DEMO_MODE", "true").lower() == "true"
        self.max_retries: int = int(os.getenv("LLM_MAX_RETRIES", "3"))
        self.retry_delay: float = float(os.getenv("LLM_RETRY_DELAY", "2"))

        self.base_url: Optional[str] = os.getenv("OPENAI_BASE_URL") or None

        # Instantiate client only if key is available
        if OPENAI_AVAILABLE and self.api_key and self.api_key != "sk-your-openai-api-key-here":
            self._client = AsyncOpenAI(
                api_key=self.api_key,
                base_url=self.base_url,  # None → default OpenAI URL
            )
        else:
            self._client = None
            if self.demo_mode:
                console.print(
                    "[yellow]LLMClient: DEMO_MODE active — using dummy responses[/yellow]"
                )

    # -----------------------------------------------------------------------
    # Public API
    # -----------------------------------------------------------------------

    async def complete(
        self,
        system: str,
        user: str,
        temperature: float = 0.2,
        model: Optional[str] = None,
        max_tokens: int = 4096,
    ) -> str:
        """
        Make a single (non-streaming) chat completion call.

        Args:
            system:      System prompt — sets the AI's role/persona.
            user:        User message — the actual task or question.
            temperature: Sampling temperature. Use 0.0 for deterministic code
                         generation, 0.7 for creative descriptions.
            model:       Override the default model for this call only.
            max_tokens:  Maximum response length in tokens.

        Returns:
            The assistant's reply as a plain string.

        TODO (implementer):
            The skeleton returns a dummy string in DEMO_MODE.
            For real behaviour the call is already wired — just ensure
            OPENAI_API_KEY is set in .env.
        """
        resolved_model = model or self.model
        self._log_prompt(system, user, resolved_model)

        if self._client is None:
            return self._demo_complete(system, user)

        try:
            response = await self._complete_with_retry(
                system=system,
                user=user,
                model=resolved_model,
                temperature=temperature,
                max_tokens=max_tokens,
            )
            content = response.choices[0].message.content or ""
            self._log_response(content)
            return content

        except Exception as exc:
            self._log_error(exc)
            return DEMO_RESPONSE

    async def stream(
        self,
        system: str,
        user: str,
        temperature: float = 0.2,
        model: Optional[str] = None,
        max_tokens: int = 4096,
    ) -> AsyncGenerator[str, None]:
        """
        Make a streaming chat completion call.

        Yields incremental text chunks as they arrive from the API.
        Use this for long migrations where you want to stream tokens to the
        WebSocket as they are produced.

        Args:
            system:      System prompt.
            user:        User message.
            temperature: Sampling temperature.
            model:       Optional model override.
            max_tokens:  Maximum response length.

        Yields:
            Incremental string deltas from the LLM.

        TODO (implementer):
            Wire the yielded chunks to the WebSocket manager so the UI shows
            a live code generation feed. See websocket_manager.py for how to
            broadcast events.
        """
        resolved_model = model or self.model
        self._log_prompt(system, user, resolved_model, streaming=True)

        if self._client is None:
            # In demo mode, yield the dummy response word by word to simulate streaming
            for word in DEMO_RESPONSE.split():
                yield word + " "
                await asyncio.sleep(0.05)
            return

        try:
            stream = await self._client.chat.completions.create(
                model=resolved_model,
                messages=[
                    {"role": "system", "content": system},
                    {"role": "user",   "content": user},
                ],
                temperature=temperature,
                max_tokens=max_tokens,
                stream=True,
            )
            async for chunk in stream:
                delta = chunk.choices[0].delta.content
                if delta:
                    yield delta

        except Exception as exc:
            self._log_error(exc)
            yield DEMO_RESPONSE

    # -----------------------------------------------------------------------
    # Internal helpers
    # -----------------------------------------------------------------------

    async def _complete_with_retry(
        self,
        system: str,
        user: str,
        model: str,
        temperature: float,
        max_tokens: int,
    ):
        """
        Wraps the OpenAI call with tenacity retry logic.

        Retries on RateLimitError and APIConnectionError with exponential
        backoff (2s → 4s → 8s). APIError (e.g. invalid request) is NOT
        retried because it won't change on retry.

        TODO (implementer): tune wait_exponential multiplier/max for your
        OpenAI tier. Tier 1 has aggressive rate limits.
        """
        # Build a decorated inner function at call time so tenacity picks up
        # the instance's max_retries setting.
        @retry(
            stop=stop_after_attempt(self.max_retries),
            wait=wait_exponential(multiplier=self.retry_delay, min=2, max=30),
            retry=retry_if_exception_type((RateLimitError, APIConnectionError)),
            reraise=True,
        )
        async def _call():
            return await self._client.chat.completions.create(
                model=model,
                messages=[
                    {"role": "system", "content": system},
                    {"role": "user",   "content": user},
                ],
                temperature=temperature,
                max_tokens=max_tokens,
            )

        return await _call()

    def _demo_complete(self, system: str, user: str) -> str:
        """
        Returns a realistic-looking dummy response for DEMO_MODE.

        TODO (implementer): expand this to return structured JSON matching
        the expected schema for each layer's prompt, so the pipeline can
        run fully end-to-end without an API key during demos.
        """
        # Return a response that looks like business rule extraction JSON
        return (
            '{"rules": [{"title": "Demo Rule", "description": '
            '"Placeholder business rule — replace with real LLM output", '
            '"hardcoded_values": ["1000", "0.025"], "confidence": "High"}]}'
        )

    def _log_prompt(
        self, system: str, user: str, model: str, streaming: bool = False
    ) -> None:
        """Print the prompt to console when DEMO_MODE is active."""
        if not self.demo_mode:
            return
        mode_label = "STREAMING" if streaming else "COMPLETE"
        console.print(
            Panel(
                f"[bold cyan]MODEL:[/bold cyan] {model}  [dim]({mode_label})[/dim]\n\n"
                f"[bold green]SYSTEM:[/bold green]\n{system[:400]}{'...' if len(system) > 400 else ''}\n\n"
                f"[bold yellow]USER:[/bold yellow]\n{user[:600]}{'...' if len(user) > 600 else ''}",
                title="[bold]LLM PROMPT[/bold]",
                border_style="blue",
                expand=False,
            )
        )

    def _log_response(self, content: str) -> None:
        """Print the response to console when DEMO_MODE is active."""
        if not self.demo_mode:
            return
        console.print(
            Panel(
                content[:800] + ("..." if len(content) > 800 else ""),
                title="[bold]LLM RESPONSE[/bold]",
                border_style="green",
                expand=False,
            )
        )

    def _log_error(self, exc: Exception) -> None:
        """Print errors clearly in DEMO_MODE."""
        if self.demo_mode:
            console.print(f"[bold red]LLMClient error:[/bold red] {exc}")
