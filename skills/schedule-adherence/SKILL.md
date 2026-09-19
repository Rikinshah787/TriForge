---
name: schedule-adherence
description: Procedure for MedForge schedule investigator — miss patterns, medicine timetable, escalation rules.
---

# Schedule adherence skill

## Goal
Decide whether a missed dose is a one-off or a pattern that needs escalation.

## Required tools
1. `memory_get` with key `patient:{patient_id}` for chart + schedule.
2. `get_adherence_history` for recent misses.
3. `memory_put` to store your investigator JSON under `session:{session_id}:schedule`.

## Rules
- Pattern rule: **2+ missed doses in 7 days** for the same medication → severity high.
- Always cite miss count and the pattern rule in evidence.
- Never invent history — only tool/memory data.
- Do not call the caregiver. Recommend the human approval gate when patterned.

## Output
Return JSON: `agent`, `status`, `severity`, `confidence`, `score`, `summary`, `evidence`, `recommended_action`.
