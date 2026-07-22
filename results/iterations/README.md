# Iteration record

Every methodological iteration of this system gets a numbered file here **before
work moves on**: what changed (method), what was measured (outcome), and the
causal analysis of why the numbers moved (reasoning). This folder is corpus for
the paper — the negative results, dead ends, and non-replications are as much
part of the record as the final table.

## The rule

1. One file per iteration: `iteration-NN.md`, numbered in order, never renumbered.
2. Each file states: **date, method (what changed and where in the code), outcome
   (measured numbers with counts), reasoning (why the numbers moved), evidence
   (where the raw data lives), and what the iteration taught us**.
3. Metrics snapshots are frozen beside the file as `iteration-NN-metrics.json`.
   `results/metrics.json` is always the *current* run and gets overwritten;
   the numbered snapshots never do.
4. A new measured run without a new iteration file is an error —
   `npm run test:results` checks that the latest metrics snapshot matches
   `results/metrics.json`.
5. No verbatim interview content in this folder — numbers, methods, and analysis
   only. Raw per-turn rows stay local (see the repository privacy rules).

## Index

| Iteration | Date | One line |
|---|---|---|
| [01](iteration-01.md) | 2026-07-16 | Regex product + reimplemented-gate ablation: A4 admits 0/59; the bug reported as a finding |
| [02](iteration-02.md) | 2026-07-21 | Contract-derived gate built; replay probes isolate three mechanical causes of the collapse |
| [03](iteration-03.md) | 2026-07-21 | Five constraint classes, stateless harness, first controlled run: structure-vs-grounding tension measured |
| [04](iteration-04.md) | 2026-07-21 | Entity resolution + context discipline; re-measured: iteration-03's headline EF contrast does not replicate |
| [04-audit](iteration-04-claims-audit.md) | 2026-07-21 | Claims-vs-measurements audit: dead title, wrong denominator, missing A1-vs-A5 test |
| [05](iteration-05.md) | 2026-07-21 | Edge grounding + per-turn framing; property padding discovered as a hallucination channel and fixed |
| [06](iteration-06.md) | 2026-07-22 | First deployed trial: voice-loop race, fragment answering, display naming, near-dupe threshold bug; research export built. Measured run pending corpus |
