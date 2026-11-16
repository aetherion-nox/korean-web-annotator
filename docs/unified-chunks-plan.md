# Unified long-text analysis

Approved scope: both plugins use sentence ending, horizontal whitespace, newline,
then Unicode-safe hard cuts, only above 20,000 UTF-16 units. Search the latter
half of the permitted chunk to avoid tiny chunks. Carry up to two neighboring
sentences, capped at 1,000 units per side, as model-only pooled sentence metadata.
Never change target offsets or create targets for supplemental context. Budget
and review-cache identity must include this context even when full-page context
is omitted. Ordinary unsplit inputs receive no additional context.

SRT: merge Korean runs across whitespace/newlines within one cue, retaining exact
source substrings and offsets. Never merge across cues, English, markup or other
protected gaps. Preserve timestamp, bilingual text, formatting and result layers.

Approach: one identical text-chunks.js in both distributables; keep their existing
DOM and SRT projection code. Whole-neighbor copies waste budget; overlapping
analysis changes ownership, so neither is used.

Implementation plan:
- [x] Add failing boundary, adjacent-context, batching and SRT multiline tests.
- [x] Implement common splitter and connect paragraph and SRT extraction.
- [x] Pool mandatory adjacent context and connect both review pipelines/caches.
- [x] Run full suites, review, update versions and package both distributions.

Review focus: CRLF/surrogate boundaries; same-text occurrences with different
neighbors; budget fallback; split spans and streamed rollback; bilingual or
already-annotated SRT gaps. Tests cover each below.

Verification: full test suites passed; independent review found no major bugs.
Real Pyodide/Kiwi SRT run validated 3 chunks and 3,001 annotations.
Review follow-up: decimal-at-window-edge defect reproduced RED then fixed GREEN; original text and earlier safe space preserved.
