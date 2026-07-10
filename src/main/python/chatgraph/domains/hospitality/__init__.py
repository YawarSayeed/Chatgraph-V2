"""The hospitality expert knowledge-capture domain."""

from pathlib import Path

from chatgraph.domains import Domain, register
from chatgraph.domains.hospitality.agent_prompt import (
    OPENING_LINE,
    SYSTEM_PROMPT as AGENT_SYSTEM_PROMPT,
)
from chatgraph.domains.hospitality.extractor_prompt import EXTRACTOR_PROMPT_INTRO


_SCHEMA_PATH = (
    Path(__file__).resolve().parents[4] / "json" / "hospitality.json"
)


DOMAIN = Domain(
    name="hospitality",
    schema_path=_SCHEMA_PATH,
    agent_system_prompt=AGENT_SYSTEM_PROMPT,
    extractor_prompt_intro=EXTRACTOR_PROMPT_INTRO,
    opening_line=OPENING_LINE,
    description=(
        "Expert interview capturing hospitality operating knowledge, guest "
        "experience principles, timing policies, service recovery rules, "
        "heuristics, loyalty drivers, and contextual constraints."
    ),
)


register(DOMAIN)
