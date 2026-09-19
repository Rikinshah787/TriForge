---
name: wellness-distress
description: Procedure for interpreting check-in text after a missed reminder call.
---

# Wellness distress skill

## Required tools
1. `analyze_wellness_text`
2. `memory_get` for reminder outcome if present
3. `memory_put` to `session:{session_id}:wellness`

## Rules
- Flag: confused, dizzy, help, scared, lost, unwell, unreachable.
- No response after reminder is itself a wellness signal — mention it.
- Do not invent symptoms.

## Output
Investigator JSON contract.
