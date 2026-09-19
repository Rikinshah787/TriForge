# Person A Evidence Integration

`POST /api/sessions` is the boundary delivered by Person A. It accepts:

```json
{"patientId":"eleanor","medicationId":"apixaban","wellnessText":"I feel dizzy"}
```

The response contains `session` plus an `investigators` array in this stable
shape:

```json
{
  "agent": "schedule-investigator",
  "status": "complete",
  "severity": "low | medium | high",
  "confidence": 0.93,
  "score": 26,
  "summary": "...",
  "evidence": [{"label":"...","value":"..."}],
  "recommended_action": "...",
  "completed_at": "ISO-8601 timestamp"
}
```

All four investigators fan out concurrently through `Promise.all`. The
Clinical Risk Investigator attempts RxNav and OpenFDA lookups with a 1.4s
timeout. If either public service is unavailable, it returns the same contract
using the repository-backed medication-risk skill and marks `source` as
`versioned_fallback`. Pharmacy is intentionally mock data and labels itself as
such in evidence.

The evidence side has no authority to call, alert, or dismiss. Person B can
send the returned investigator array directly to its Correlation Agent and
Human Approval Gate.
