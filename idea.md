# MedGuard Agent Demo

MedGuard is a safety net for missed medication events. It is not a reminder app. Reminders assume the senior will act; MedGuard handles the case where they do not.

## Core Demo Flow

1. A caregiver triggers a missed-dose event.
2. The Orchestrator starts an investigation session.
3. Four investigator agents run in parallel:
   - Schedule Investigator: checks whether this is a pattern or a one-off miss.
   - Clinical Risk Investigator: classifies how dangerous the missed medication may be.
   - Pharmacy Investigator: checks whether refill status may explain the miss.
   - Wellness Investigator: checks whether the patient seems confused, distressed, or unreachable.
4. The Correlation Agent combines all evidence into one risk score and plain-language narrative.
5. The Human Approval Gate shows the evidence and asks for an approved action.
6. The Escalation Agent executes the selected action and writes an audit record.

## Investigator JSON Contract

Each investigator returns the same outer shape so Person A and Person B can integrate without guessing.

```json
{
  "agent": "schedule-investigator",
  "status": "complete",
  "severity": "low | medium | high",
  "confidence": 0.92,
  "summary": "Second missed apixaban dose in 7 days.",
  "evidence": [
    {
      "label": "Miss count",
      "value": "2 misses / 7 days"
    }
  ],
  "recommended_action": "Escalate to caregiver approval gate."
}
```

## Person A Scope

Person A owns evidence collection:

- Orchestrator session start.
- Missed-dose trigger.
- Schedule Investigator.
- Clinical Risk Investigator.
- Pharmacy Investigator.
- Wellness Investigator.
- Consistent JSON outputs for Person B.

## Safety Model

- The agents can collect, summarize, and recommend.
- The agents cannot place calls, send alerts, or dismiss events without human approval.
- Every approved action writes an audit record.
- The demo clearly labels mocked data versus real/public API data.
- Pharmacy remains mocked.
- Rx risk can later be connected to OpenFDA/RxNav.

## Judge Answer

If this were just about nagging harder, agents would be unnecessary. The agents exist because the question "does this missed dose actually matter?" requires correlating adherence history, medication risk, refill state, and wellness signals. Real-world action still needs a human approval gate.
