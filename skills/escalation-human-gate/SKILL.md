---
name: escalation-human-gate
description: Procedure for caregiver call/SMS only after explicit human approval.
---

# Escalation skill

## Required tools
- `place_caregiver_call` when approved_action=call
- `send_caregiver_sms` when approved_action=alert
- `memory_put` final escalation under `session:{session_id}:escalation`

## Rules
- Never infer approval from evidence alone.
- approved_action must be exactly call, alert, or dismiss.
- Write clear spoken/SMS copy naming patient + medication.
