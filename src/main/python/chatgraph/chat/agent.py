"""Conversational agent (Claude Sonnet, streaming).

The Agent is domain-agnostic. The system prompt is supplied at
construction time by a :class:`chatgraph.domains.Domain`. The Agent
streams replies and supports a non-streaming ``complete()`` for utility
calls (e.g. generating a resume opening question from a graph summary).
"""

from __future__ import annotations

import os
from collections.abc import AsyncIterator
from dataclasses import dataclass, field

from anthropic import AsyncAnthropic


DEFAULT_MODEL = "claude-sonnet-4-6"


@dataclass
class Conversation:
    """Rolling chat history for the agent.

    Messages alternate between "user" (the patient) and "assistant" (the
    agent). The system prompt is held separately and passed on every call.
    """

    messages: list[dict] = field(default_factory=list)

    def add_user(self, text: str) -> None:
        self.messages.append({"role": "user", "content": text})

    def add_assistant(self, text: str) -> None:
        self.messages.append({"role": "assistant", "content": text})


class Agent:
    def __init__(
        self,
        system_prompt: str,
        api_key: str | None = None,
        model: str | None = None,
    ) -> None:
        api_key = api_key or os.environ.get("ANTHROPIC_API_KEY")
        if not api_key:
            raise RuntimeError("ANTHROPIC_API_KEY is not set")
        self._client = AsyncAnthropic(api_key=api_key)
        self._model = model or os.environ.get("CHATGRAPH_AGENT_MODEL", DEFAULT_MODEL)
        self._system = system_prompt

    async def stream_reply(
        self,
        conversation: Conversation,
        extra_system: str | None = None,
    ) -> AsyncIterator[str]:
        """Yield response text chunks for the current conversation state.

        Optionally append ``extra_system`` to the system prompt for this
        call only -- useful for per-turn state ("patient has signaled
        they're done; acknowledge briefly and stop asking questions").

        Cancellable: if the caller's asyncio task is cancelled mid-stream
        (the barge-in case), the underlying HTTP stream closes cleanly.
        """
        system = self._system
        if extra_system:
            system = system + "\n\n[SESSION STATE]\n" + extra_system
        async with self._client.messages.stream(
            model=self._model,
            max_tokens=400,
            system=system,
            messages=conversation.messages,
        ) as stream:
            async for delta in stream.text_stream:
                yield delta

    async def complete(self, user_prompt: str, system: str | None = None) -> str:
        """One-shot non-streaming completion.

        Used for short utility calls (e.g. generating a resume opening
        question from a graph summary). Returns the model's full reply.
        Defaults to the agent's clinical-interview system prompt; pass
        ``system`` to override.
        """
        resp = await self._client.messages.create(
            model=self._model,
            max_tokens=200,
            system=system if system is not None else self._system,
            messages=[{"role": "user", "content": user_prompt}],
        )
        return "".join(
            getattr(b, "text", "") for b in resp.content if hasattr(b, "text")
        ).strip()
