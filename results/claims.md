# Claim registry

Every claim the paper makes (or will make), with its type, the measurement that
backs it, where the raw evidence lives, and its current status. A claim with
status **pending-corpus** is stated as a design claim only until the next
measured run validates it; nothing here is reported as measured unless a
committed metrics file carries the counts.

Statuses: **measured** (counts in a committed metrics file), **fixed,
pending-validation** (defect measured, fix deployed, re-measurement awaited),
**design** (architectural property argued from construction and unit tests, not
from corpus statistics), **pending-corpus** (awaiting the multi-session corpus).

All ablation figures are from the single-session iteration-05 run
(`results/iterations/iteration-05-metrics.json`, current `results/metrics.json`);
live figures are from the 2026-07-22 deployed-session audit
(`results/live_session_audit.json`). Both will be superseded by the
multi-session corpus run when OpenAI credit is restored — this registry then
gets re-verified line by line.

---

## C1 — Provenance by construction

**Claim.** The gate makes provenance structural: the extractor attaches an
inline `evidence` object, the gate materializes the evidence vertex, picks the
provenance edge from the schema, and stamps the episode and speaker itself.
Orphan or fabricated provenance is unrepresentable, and every admitted trace is
a verbatim span of the utterance it cites.

**Type.** Design claim + measured span validity.

**Backing.**
- Live session (deployed app, 47 user turns): span rule held on 54/54 grounded
  facts and 30/30 grounded edges (100%, CI 93.4–100 / 88.6–100) —
  `results/live_session_audit.json`.
- Gate conformance tests: gate overwrites model-supplied speaker/episode,
  drops extractor-authored `ProvenanceEvidence` vertices, rejects non-span
  traces (`src/test/js/gate_conformance.mjs`).

**Status.** Measured (span validity); design (unrepresentability).

## C2 — Structural evidence moves coverage from ~0–5% to 85–100%

**Claim.** Asking the model to *remember* provenance yields near-zero coverage;
making it structural yields high coverage. Three independent measurements:

| Measurement | Coverage |
|---|---|
| Legacy 2026-07-16 run (remembered provenance) | ~0–5% |
| Gated ablation A5 (harness, deployed gate) | 39/46 = 84.8% vertices, 13/20 = 65.0% edges |
| Live deployed session | 54/57 = 94.7% vertices, 30/40 = 75.0% edges |

**Type.** Measured.

**Backing.** `results/metrics.json` (A5), `results/live_session_audit.json`,
`results/legacy-2026-07-16/`.

**Status.** Measured.

## C3 — Typed gating turns free-form output into usable knowledge

**Claim.** Ungated free-form extraction produces faithful but unusable output
(A0: EF 48/52 = 92.3% but 0/52 conforms to the schema, so usable-faithful yield
is 0%). The gated pipeline admits only conforming facts: A5 usable-faithful
yield 54/66 = 81.8%, usable-faithful facts per eligible turn 1.28 (A1) → 1.69
(A5), +32% over constrained decoding alone.

**Type.** Measured.

**Backing.** `results/metrics.json` conditions A0/A1/A5; the per-turn
denominator (32 eligible turns) is constant across conditions by construction.

**Status.** Measured. Note honestly: A1→A5 usable-faithful *yield* difference
is not significant on one session (exact McNemar p = 1.0); the claim rests on
the conformance and provenance dimensions, not on yield alone.

## C4 — Hard severity buys coverage, not faithfulness

**Claim.** Enforcing the provenance requirement hard (A4-strict) instead of
soft (A4) raises provenance coverage but lowers usable yield (68.2% vs 76.6%),
and does not improve evidential faithfulness (84.9% vs 83.1%). Severity is a
coverage/throughput dial, not a truthfulness dial — which is why the deployed
spec marks HR006 soft and relies on retry + audit instead.

**Type.** Measured (single session; directional).

**Backing.** `results/metrics.json` A4 vs A4-strict.

**Status.** Measured, to be re-tested on the corpus before the paper states it
generally.

## C5 — Prompt sensitivity and non-replications are part of the record

**Claim.** Two published-looking effects did not survive re-measurement: the
iteration-03 A0-vs-gated EF contrast collapsed when the prompt was fixed
(iteration-04), and the expected retry-cost penalty ran in the opposite
direction on one session. The methodology (frozen per-iteration snapshots,
claim verifier) exists precisely to keep such non-replications visible.

**Type.** Measured negative results.

**Backing.** `results/iterations/iteration-04.md`, `iteration-05.md`;
`npm run test:paper` requires the paper to carry the "not significant" and
"non-replication" statements.

**Status.** Measured.

## C6 — Property padding is a hallucination channel EF misses

**Claim.** Evidential faithfulness judged at the fact level misses fabricated
*property values*: the live audit found 33/57 facts (57.9%) carrying at least
one padded property (58 padded values total, mostly booleans stamped `true`),
while fact-level EF was 51/57 = 89.5%. Citation-correctness auditing catches
what EF misses.

**Type.** Measured (defect); mitigation deployed.

**Backing.** `results/live_session_audit.json`; mitigation is the type-derived
ASSERTION-ONLY prompt rule (`lib/gate/prompt.ts::assertionOnlyProperties`,
derived from the schema's declared boolean/integer value types, so the list
cannot drift) plus the echo guard.

**Status.** Measured defect; fix **pending-validation** on the next corpus.

## C7 — Grounding is not coherence: the identity-mutation channel

**Claim.** A graph can be 100% span-grounded and still wrong: the live session
held the span rule on every grounded item, yet 12/40 semantic edges (30%) were
judged incoherent. Root cause was identity mutation — the extractor reused an
existing content-hash id for a different concept, and last-write-wins merging
relabeled the stored vertex ("loyalty program" became "theft"), leaving edges
attached to the wrong concept. Symbolic admission must therefore also check
*identity consistency*, not just span validity.

**Type.** Measured (defect); mitigation deployed.

**Backing.** `results/live_session_audit.json`,
`results/iterations/iteration-06-defects.json` (D-06-1); fix is the
identity-consistent reused-id check in `lib/gate/gate.ts` (a reused id whose
content names a different concept is de-collided and reported), covered by two
conformance tests.

**Status.** Measured defect; fix **pending-validation** on the next corpus.

## C8 — Cross-turn relationships need their own witness (HR026)

**Claim.** Edges connecting two *already-known* entities were the weakest
population in the live audit: 21/40 relationships judged supported (52.5%),
edge citation correctness 9/30 (30.0%). These edges could be minted from graph
memory with no utterance asserting them. HR026 — a knowledge-knowledge edge
whose endpoints both pre-exist must carry its own span-valid evidence or be
rejected for retry — closes the channel. The rule is authored in the governance
spec (`hopitality files/validation rules.json`), bound by the contract, and
enforced hard.

**Type.** Measured motivation; rule deployed.

**Backing.** `results/live_session_audit.json` (edge metrics);
`lib/gate/gate.ts` (enforcement), three conformance tests (witnessless
rejected+retryable, witnessed admitted, fresh-endpoint exempt).

**Status.** Motivation measured; effect **pending-corpus**.

## C9 — The methodology is the contribution's spine

**Claim.** Every figure is regenerable and every claim is machine-checked:
(a) the ablation harness imports the deployed gate — there is no second gate
implementation to drift; (b) extraction is stateless, so attempt-1 proposals
are identical across conditions; (c) every methodological iteration is frozen
as a numbered record with metrics snapshot before work moves on, and
`npm run test:results` fails if the current run is not the latest snapshot;
(d) `npm run test:paper` verifies all paper figures against
`results/metrics.json` (53 figures at last count), including required
negative-result statements; (e) the live-session judge is cross-family (Claude
judging a GPT extractor's output).

**Type.** Design claim, machine-enforced.

**Backing.** `scripts/nesy_results/run_gated_ablation.mjs` (imports
`lib/gate`), `scripts/nesy_results/verify_paper_claims.mjs`,
`scripts/nesy_results/validate_results.mjs`, `results/iterations/`.

**Status.** In force.

---

## What the next corpus run must decide

1. C6/C7 fixes: padded-property rate and edge-incoherence rate on the improved
   system (target: both materially down from 57.9% and 30.0%).
2. C8: edge citation correctness under HR026 (target: up from 30.0%), and the
   admission cost it charges (how many witnessless edges are rejected).
3. C3/C4: whether the A1→A5 usable-yield gap reaches significance with more
   sessions, and whether the A4/A4-strict direction holds.
4. Filler handling: eligible-turn counts now derive from the shared
   `lib/filler.ts` in both product and harness — corpus stats must state the
   filler exclusion count per session.
