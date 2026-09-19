# MedGuard Safety Model

MedGuard is decision support for a missed-dose event, not an autonomous care
system.

| Layer | May do | Must not do |
| --- | --- | --- |
| Evidence agents | Read schedule, medication, refill, and check-in signals; summarize evidence; recommend | Diagnose, notify, call, or dismiss an event |
| Correlation | Calculate a transparent risk score and narrative from returned evidence | Execute an action |
| Human approval gate | Show evidence and let an authorized person choose `call`, `alert`, or `dismiss` | Hide uncertainty or bypass the approver |
| Escalation | Execute only the human-approved option and write an audit record | Choose the option itself |

The Clinical Risk Investigator uses RxNav and OpenFDA only as enrichment. Its
versioned local classification remains available when a public API is slow or
unavailable, and the returned `source` field labels which path was used.

Pharmacy data and the text-based voice check-in are intentionally marked as
demo mocks. The UI should not imply they are live clinical records.
