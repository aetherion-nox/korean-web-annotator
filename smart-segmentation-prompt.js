// Only included when experimental smart segmentation is enabled.
export const SMART_SEGMENTATION_INSTRUCTIONS = [
 'Kiwi tokenization and target boundaries are proposals, not ground truth; kiwi_tokens are compact [form,POS,start,end] tuples. Inspect original sentences including gaps with no targets, and check splits, merges, POS, stems, particles, endings and omissions.',
 'Keep the ordinary results decision for EVERY target, even one you repair. For scan_only targets return KEEP; they exist only to inspect a sentence with no dictionary targets. Put results first and optional repairs afterward. Only for actual boundary/omission errors, return repairs (or omit it when none): each repair has exactly sentence_id,op,old_target_ids,start,end,surface,choice_id.',
 'add: old_target_ids=[] for an omitted word; replace: list every affected old target_id to merge, split or shift; delete: list wrong target IDs and use KEEP. For a split, account for the entire old Korean word, using separate KEEP spans for unchanged endings or particles. For a repaired word, give genuine Hanja, borrowed Latin-script original or KEEP without consulting old choices.',
 'Use sentence_id and target_id exactly. start/end are approximate UTF-16 positions in the original sentence; surface MUST be an exact source substring. Preserve spaces and morphology; the local validator may fix only an unambiguous nearby offset. Never invent uncertain origins or personal-name Hanja; use KEEP when unsure. Do not repeat unchanged tokenization.'
].join('\n');

