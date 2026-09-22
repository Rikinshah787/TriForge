---
name: clinical-skip-risk
description: Procedure for classifying medication skip risk using live RxNav/openFDA evidence.
---

# Clinical skip-risk skill

## Required tools
1. `memory_get` patient chart for conditions/diagnostics.
2. `lookup_drug_risk` with medication_name.
3. `memory_put` result to `session:{session_id}:clinical`.

## Rules
- High-risk examples: anticoagulants, anti-seizure, insulin, transplant meds.
- If live APIs unavailable, say so and use tool fallback classification.
- Never invent RxNav/openFDA fields.

## Output
Investigator JSON contract with evidence labels from the tool.
