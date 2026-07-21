# Iteration 02 — Diagnostic probes and the contract-derived gate

**Date:** 2026-07-21 (morning)
**Status:** superseded by iteration 03; probe results remain valid and are pinned by
the conformance suite's frozen replay.

## Method

Before changing anything, three zero-cost probes replayed iteration 01's **frozen
final-attempt deltas** (no new API calls) to separate mechanical failure from
semantic strictness:

1. **Per-fact replay.** Re-adjudicate the archived deltas admitting each fact
   individually instead of rejecting whole deltas.
2. **Orphan-evidence probe.** For every knowledge vertex rejected for missing
   provenance, check whether usable evidence already existed in the same delta
   (an unlinked `ProvenanceEvidence` vertex whose traceText passes the
   anti-generic rule).
3. **Severity audit.** Diff the harness's enforcement against the authored
   `validation rules.json` severities.

Then the first version of the deployed gate was built:
`lib/gate/contract.ts` (one contract derived from schema + governance specs, with
unbindable rules reported as **drift** and disabled), `lib/gate/gate.ts` (per-fact
admission, severities from the spec, structural provenance via an inline `evidence`
field materialized by the gate), `lib/gate/prompt.ts` (schema reference and tool
schema generated from the contract). Hospitality extraction was rewired through it
(`lib/server/extract-governed.ts`), deleting the regex extractor.

## Outcome

**Probe 1 — per-fact vs per-delta on identical proposals:**

| Cond. | Published (per-delta) | Per-fact replay |
|---|---|---|
| A3 | 29/48 (60.4%) | **47/48 (97.9%)** |
| A5 | 3/61 (4.9%) | **60/61 (98.4%)** |

**Probe 2 — orphan evidence:** of 48 knowledge vertices proposed under A4, 6 were
linked to evidence, 33 had a usable orphan evidence node in the same delta, 9 were
curable from the utterance, **0 were incurable**. Same shape for A5. The provenance
gate had been rejecting facts whose evidence the model had already written down.

**Probe 3 — severity drift:** HR006/HR007 declared `soft` in the spec, enforced
`hard` by the harness. Additionally the anti-generic rule's thresholds
(min tokens, overlap) existed only in the harness, not in any spec, and
overlap(u,u)=1 made it trivially satisfiable by echoing the whole utterance.

**Live wiring result:** with the gate deployed, provenance coverage on real turns
went 60% → **100% (9/9)** after one change — deleting hand-written prompt text that
told the extractor to author `ProvenanceEvidence` vertices itself, contradicting
the generated instructions. Contract drift at this point: 3 findings (schema
forbade spec'd provenance endpoints ×2; HR015 targeted an undeclared property).

## Why it happened

The iteration-01 collapse was **not** semantic strictness: every constraint failure
traced to representation or configuration. The decisive design consequence: make
provenance *structural* (evidence carried inline on the fact; the gate materializes
the node and picks the typed edge) so the orphan-evidence failure mode becomes
unrepresentable rather than detected; admit per fact; read severities from the spec.

The 60% → 100% live jump demonstrated the drift thesis in miniature: the only
broken layer was a hand-written copy of something the contract already generated.

## What it taught us

- Diagnose on frozen data before spending on new runs — all three root causes were
  recoverable from the archived deltas for free.
- Drift is the dominant failure mode and must be *detected*, not avoided by
  discipline: the contract now reports and disables anything it cannot bind.
- Structural constraints beat behavioural instructions (~90 points of provenance
  coverage came from the representation change, none from better prompting).

## Evidence

- Frozen replay pinned in `src/test/js/gate_conformance.mjs` ("per-fact admission
  recovers the facts per-delta rejection discarded") against
  `results/legacy-2026-07-16/raw/` (local only; quotes the expert verbatim).
- Gate implementation: `lib/gate/` at commits `f09265d`, `317a7c4`.
