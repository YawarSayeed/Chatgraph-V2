# Completed Human Audit Intake

Place these completed files in this directory:

- `annotator_A.csv`
- `annotator_B.csv`
- `adjudicated.csv`

Keep the columns and `fact_id` values from the shipped forms. Fill every
`human_verdict` with `yes`, `no`, or `unclear`, then run:

```bash
npm run results:audit
```

The ingester computes Cohen's kappa from the two pre-adjudication files and EF
from the adjudicated file. `unclear` is reported separately and excluded from
the EF denominator.
