# Medication Risk Skill

Classify the acute consequence of a missed medication dose. This skill is
deliberately deterministic: public drug data can enrich the evidence but may
not change the configured safety class without clinical review.

| Medication | Class | Missed-dose severity |
| --- | --- | --- |
| apixaban | Anticoagulant | high |
| metformin | Diabetes therapy | medium |
| vitamin D | Supplement | low |

Always recommend human review for high-severity medication events.
