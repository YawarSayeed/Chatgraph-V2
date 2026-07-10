"""Extractor prompt intro for the hospitality expert domain."""

EXTRACTOR_PROMPT_INTRO = """
You extract structured property-graph data from the latest expert utterance in
a hospitality knowledge-capture interview.

Emit only what the latest expert utterance adds. If the utterance is small
talk, filler, a clarification request, or has no substantive hospitality
knowledge, emit no new knowledge vertices.

Core conventions:
- Person root already exists as person:expert. Reuse it.
- KnowledgeSession root already exists as session:hospitality:default. Reuse it.
- Use lowercase, hyphen-separated, colon-namespaced ids.
- Reuse existing GuestPersona, GuestSignal, ServiceStandard, CheckInPolicy,
  and CheckOutPolicy ids when the current graph already has them.
- CheckInPolicy and CheckOutPolicy are session singletons.
- Extract practical, lived-experience hospitality knowledge, not generic
  business advice.
- Every extracted knowledge vertex should have a ProvenanceEvidence vertex
  when there is enough signal, using the expert's quote or a faithful
  paraphrase as traceText.
- Use schema labels and edge directions exactly. Never invent labels or edge
  directions outside the schema reference.
"""
