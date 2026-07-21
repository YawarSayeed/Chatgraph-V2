# Superseded evaluation harness (2026-07-16)

These scripts produced the package archived at `results/legacy-2026-07-16/`. They are
retained so that run remains auditable, and are no longer wired into any npm script.

They are superseded because they reimplemented the gate rather than calling it, and
that copy diverged from the specification and from the deployed code in three ways
the current harness makes impossible:

- provenance rules HR006/HR007 were enforced as `hard` although the authored
  specification declares them `soft`, which drove A4 to 0/59 admitted facts;
- admission was per delta, so one dangling edge discarded a whole turn's knowledge;
- endpoint conformance carried a hand-written exception for provenance edges that
  contradicted the committed schema.

The current harness (`../run_gated_ablation.mjs`) imports `lib/gate` directly, so no
second implementation exists to drift.
