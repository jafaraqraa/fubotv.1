# Citations & Confidence Calibration

## Citation Validator
Validates every citation ID (e.g. `[EVIDENCE_01]`) returned by generator:
- Confirms evidence item existed in supplied prompt
- Verifies document version and tenant isolation
- Computes citation coverage score

## Confidence Calibration
Computes confidence score and label (`high`, `medium`, `low`) based on:
- Top reranker score
- Multiple supporting chunks (+0.05)
- Verified citation coverage (+0.10)
