"""Dictionary-origin extension. Never infer origins from translated equivalents."""
import re
from backend.offsets import to_utf16
from backend.proper_nouns import proper_noun_ranges, overlaps_proper_noun
from app.services.disambiguation import DisambiguationService

CJK = re.compile(r'[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\U00020000-\U000323af]')
HANGUL = re.compile(r'[\u1100-\u11ff\u3130-\u318f\ua960-\ua97f\uac00-\ud7af\ud7b0-\ud7ff]')

def classify_origin(origin):
    if not isinstance(origin,str) or not origin.strip(): return 'unsupported'
    if any(ord(c)<32 or ord(c)==127 or c in '<>' for c in origin):return 'unsupported'
    if CJK.search(origin) or HANGUL.search(origin):
        return 'mixed' if any(c.isalpha() and not CJK.match(c) and not HANGUL.match(c) for c in origin) else 'unsupported'
    return 'loanword' if any(c.isalpha() for c in origin) else 'unsupported'

def is_nonconversion_origin(origin, *, hanja=True, loanword=True):
    """Missing/native-only origins explain KEEP; foreign/CJK origins cannot.

    Missing origin metadata is not positive proof of native etymology.
    """
    if origin is None:return True
    if not isinstance(origin,str):return False
    has_hanja=bool(CJK.search(origin))
    has_foreign=any(c.isalpha() and not HANGUL.fullmatch(c) and not CJK.fullmatch(c) for c in origin)
    return not ((hanja and has_hanja) or (loanword and has_foreign))

def nonconversion_options(surface, records, *, definitions_by_entry=None, **modes):
    """Independent dictionary senses that preserve Korean in the active modes."""
    options=[]
    for record in records:
        if not is_nonconversion_origin(record.get('origin_raw'), **modes):continue
        entry=record.get('entry_id',record.get('id'))
        if entry is None:continue
        definitions=(definitions_by_entry or {}).get(entry)
        if definitions is None:definitions=[record.get('definition_preview')]
        senses=list(dict.fromkeys(d for d in definitions if d))
        # Preserve the entry for the engine's batched complete-sense lookup.
        for definition in senses or [None]:
            options.append(dict(choice_id=f'n{len(options)}',type='nonconversion',replacement=surface,entry_id=entry,definitions=[definition] if definition else []))
    return options

def collect(text: str, tokens: list, entries: dict, occupied_ranges: list, *, force_review=False, hanja_enabled=True, review_ranges=()) -> dict:
    """Return UTF-16 annotations/targets; input token and occupied offsets are Python indices.

    Mixed origins belong to the validated whole-entry segmentation path.
    Only exact tokenizer-form slices qualify. Every entry (including native and
    Hanja homonyms) participates in certainty; non-conversion senses are explicit.
    """
    annotations=[];targets=[];skipped_mixed=0
    occupied=list(occupied_ranges); seen=set();proper_ranges=proper_noun_ranges(tokens)+list(review_ranges)
    for token in tokens:
        start=token.start;end=start+token.length;form=token.form
        if (start,end) in seen:continue
        seen.add((start,end))
        if getattr(token,'is_particle',False) or getattr(token,'is_punct',False):continue
        if getattr(token,'is_verb_stem',False):continue
        if not 0<=start<end<=len(text) or text[start:end]!=form:continue
        if any(start<b and a<end for a,b in occupied):continue
        records=[r for r in entries.get(form,[]) if DisambiguationService()._pos_matches(token.tag,r.get('part_of_speech')) is not False]
        # Every mixed origin requires validated segmentation; never revive a
        # failed mixed spelling as one undifferentiated foreign replacement.
        loans=[r for r in records if classify_origin(r.get('origin_raw'))=='loanword' and not CJK.search(r.get('origin_raw') or '')]
        if not loans:continue
        origins={r['origin_raw'] for r in loans}
        span=dict(start=to_utf16(text,start),end=to_utf16(text,end),surface=form)
        partial=any(t is not token and t.length>0 and (t.start+t.length==start or t.start==end) and t.tag.split('-')[0] in {'NNG','NNP','NNB','NR','XR','XPN','XSN','MM'} for t in tokens)
        if not force_review and not partial and not overlaps_proper_noun(start,end,proper_ranges) and len(origins)==1 and len(loans)==len(records):
            annotations.append(dict(span,type='loanword',replacement=loans[0]['origin_raw'],entry_id=loans[0].get('id'),definitions=[loans[0]['definition_preview']] if loans[0].get('definition_preview') else []))
        else:
            options=[dict(choice_id='KEEP',type='keep',replacement=form,entry_id=None,definitions=[])]+nonconversion_options(form,records,hanja=hanja_enabled,loanword=True)
            for i,record in enumerate(loans):
                options.append(dict(choice_id=f'c{i}',type='loanword',replacement=record['origin_raw'],entry_id=record.get('id'),definitions=[record['definition_preview']] if record.get('definition_preview') else []))
            targets.append(dict(span,target_id=f'loan{len(targets)}',context=text,options=options))
        occupied.append((start,end))
    return dict(annotations=annotations,targets=targets,skipped_mixed=skipped_mixed)

def merge_targets(text,targets):
    """Join connected UTF-16 ranges into nonoverlapping, fixed-choice reviews."""
    encoded=text.encode('utf-16-le')
    def slice16(start,end):return encoded[2*start:2*end].decode('utf-16-le')
    groups=[]
    for target in sorted(targets,key=lambda t:(t['start'],t['end'])):
        if not groups or target['start']>=max(t['end'] for t in groups[-1]):groups.append([target])
        else:groups[-1].append(target)
    merged=[]
    for i,group in enumerate(groups):
        start=min(t['start'] for t in group);end=max(t['end'] for t in group)
        surface=slice16(start,end)
        options=[dict(choice_id='KEEP',type='keep',replacement=surface,entry_id=None,definitions=[])]
        for target in group:
            for option in target['options'][1:]:
                if option['type']=='nonconversion' and (target['start']!=start or target['end']!=end):continue
                choice=dict(option)
                choice['choice_id']=f'c{len(options)-1}'
                choice['replacement']=slice16(start,target['start'])+option['replacement']+slice16(target['end'],end)
                options.append(choice)
        merged.append(dict(target_id=f't{i}',start=start,end=end,surface=surface,context=text,options=options))
    return merged
