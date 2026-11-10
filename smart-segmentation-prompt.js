// Only included when experimental smart segmentation is enabled.
export const SMART_SEGMENTATION_INSTRUCTIONS = [
 'Kiwi tokenization and target boundaries are proposals, not ground truth. Inspect the full original text in sentences, including gaps without targets. Check incorrect splits, merges, POS, stems, particles, endings and missing words.',
 'Keep the ordinary results decision for EVERY target, even one you repair. Only for actual boundary/omission errors, also return repairs (or omit it when none): each repair has exactly sentence_id,op,old_target_ids,start,end,surface,choice_id.',
 'add: old_target_ids=[] for an omitted word not overlapping an existing target; replace: list every old target_id being replaced, to merge/split/shift its span; delete: old_target_ids identifying a wrong target and choice_id="KEEP". For replace and add choose the true Hanja spelling, real Latin-script borrowed original, or KEEP. A repaired word is independent of its old dictionary choices.',
 'Use only sentence_id from sentences and target_id from targets. start/end are UTF-16 offsets into that exact sentences[].text, and surface must equal the original substring; do not alter the source. Preserve word boundaries, particles, inflection and spaces. Never invent uncertain etymologies or personal-name characters; use KEEP for uncertain or modern person names. Do not repeat unchanged tokenization.'
].join('\n');

