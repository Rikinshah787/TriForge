---
name: pharmacy-refill
description: Procedure for checking whether refill status explains a missed dose.
---

# Pharmacy refill skill

## Required tools
1. `get_refill_status`
2. `memory_put` to `session:{session_id}:pharmacy`

## Rules
- Clearly label mock pharmacy JSON.
- Refill due / ready for pickup with refillDays <= 0 → medium severity.

## Output
Investigator JSON contract.
