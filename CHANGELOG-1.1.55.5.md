# Korean Web Annotator v1.1.55.5 — offline manual review recovery

Backport based on **v1.1.55.4**. This maintenance branch does not rewrite the newer mainline.

- Page-only recovery now accepts **model-authored Hanja** and **Latin-script loanword origins** after running the *same* `literalOriginOption`, `projectAnnotation`, and Hanja-reading checks as the normal worker. No reconnect, new API request, or repeated review is needed.
- The manual batch backup includes the target metadata and repair scopes needed for offline validation. The model's raw `choice_id` is never trusted merely because it appears in JSON.
- **Smart-segmentation `repairs`** are independently verified using the same worker module, including exact source text, UTF-16 offsets, protected names, selection scope, and overlapping repair rules.
- A valid repair suppresses its superseded original targets; rejected repairs do not block unrelated valid dictionary or generated choices. Earlier offline repairs are tracked by native target IDs across batches.
- Existing dictionary choices and missing-but-unambiguous `batch_id` handling remain supported; an explicitly incorrect batch ID is still rejected.
- Validation modules are imported only when a disconnected reply needs model-generated origins or nonempty repairs. No model/network call is made.
- Added regression coverage for accepted Hanja/loanword origins, wrong readings, name protection, corrupted target IDs, expired sentence spans, and smart-segmentation repairs.

## Install / validation

This branch retains the v1.1.55.4 engine and dictionary assets, with extension version updated to **1.1.55.5**. Reload the extension and refresh the website before generating new manual batches. Old 1.1.55.4 page backups do not contain the new recovery metadata and cannot be upgraded in place.

Run `node --test tests/offline-manual-recovery.test.mjs` to exercise the recovery validator. The regular browser/E2E integration still requires testing on real pages.
