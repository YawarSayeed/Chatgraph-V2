"""Smoke test for the extractor against a clinically rich utterance.

Not a unit test in the strict sense: it actually calls Claude Haiku,
so it costs a few cents per run and requires ANTHROPIC_API_KEY +
HYDRAPOP_HOME in the environment. Useful for checking that schema
changes haven't broken the extractor's ability to produce a sensible
delta.

Run with::

    HYDRAPOP_HOME=/path/to/HydraPop \\
    .venv/bin/python -m pytest src/test/python/chatgraph/test_extractor_smoke.py -v -s
"""

import os

import pytest


needs_api_keys = pytest.mark.skipif(
    not (
        os.environ.get("ANTHROPIC_API_KEY")
        and os.environ.get("HYDRAPOP_HOME")
    ),
    reason="ANTHROPIC_API_KEY and HYDRAPOP_HOME must be set",
)


@needs_api_keys
def test_rich_utterance_produces_sensible_delta(capsys):
    """One rich utterance should yield: a Headache pattern, the Person
    -> Headache `reports` edge, a HeadacheTriggers bucket with a
    sensory trigger, at least one Quality, and a concrete pain-phase
    symptom vertex."""
    import asyncio

    from dotenv import load_dotenv

    load_dotenv()

    from chatgraph import domains as _domains
    from chatgraph.chat.extractor import Extractor, RollingContext

    async def run():
        ex = Extractor(domain=_domains.get("medical"))
        ctx = RollingContext(person_id="Person:patient")
        u = (
            "I have occasional headaches, ranging from mild to severe, "
            "occasionally with a throbbing quality. They can be triggered "
            "by light and sound, lack of sleep, and other factors. Bright "
            "light bothers me more than usual during an attack."
        )
        return await ex.extract(u, ctx)

    result = asyncio.run(run())

    labels = sorted({v.label.value for v in result.delta.vertices.values()})
    edge_labels = sorted({e.label.value for e in result.delta.edges.values()})

    print("\nVertex labels:", labels)
    print("Edge labels:  ", edge_labels)

    assert "Headache" in labels, "expected a Headache vertex"
    assert "HeadacheTriggers" in labels, "expected a HeadacheTriggers bucket"
    assert "SensoryTrigger" in labels, "expected a SensoryTrigger"
    assert "Quality" in labels, "expected at least one Quality"
    # LightSensitivity is the schema mapping for photophobia.
    assert "LightSensitivity" in labels, "expected LightSensitivity vertex"
    # The new Person->Headache reports edge.
    assert "reports" in edge_labels, "expected a reports edge"
    # The new triggers / sensory reified path.
    assert "triggers" in edge_labels
    assert "sensory" in edge_labels
    # Concrete symptom edge.
    assert "hasLightSensitivity" in edge_labels
