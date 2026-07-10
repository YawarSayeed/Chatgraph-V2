"""The medical (headache) domain.

Importing this module registers the domain in
``chatgraph.domains.REGISTRY`` under the name ``"medical"``.
"""

from pathlib import Path

from chatgraph.domains import Domain, register
from chatgraph.domains.medical.agent_prompt import (
    OPENING_LINE,
    SYSTEM_PROMPT as AGENT_SYSTEM_PROMPT,
)
from chatgraph.domains.medical.extractor_prompt import EXTRACTOR_PROMPT_INTRO


# Schema JSON path: project_root/src/main/json/medical.json. Generated
# by chatgraph-build-schema medical and committed to the repo; this
# module reads it as a peer artifact of the Python sources, both
# living under src/main/. Path computed relative to this file so it
# works regardless of CWD.
# parents[4] from this file is src/main/, so the resolved path is
# src/main/json/medical.json. Ancestry for reference:
#   [0]=medical [1]=domains [2]=chatgraph [3]=python
#   [4]=main    [5]=src     [6]=project_root
_SCHEMA_PATH = (
    Path(__file__).resolve().parents[4] / "json" / "medical.json"
)


DOMAIN = Domain(
    name="medical",
    schema_path=_SCHEMA_PATH,
    agent_system_prompt=AGENT_SYSTEM_PROMPT,
    extractor_prompt_intro=EXTRACTOR_PROMPT_INTRO,
    opening_line=OPENING_LINE,
    description=(
        "Doctor-like interview about headache disorders. Covers ICHD-3 "
        "classification, attack phases, triggers, alleviating factors, "
        "red flags, family history, and functional impact."
    ),
)


register(DOMAIN)
