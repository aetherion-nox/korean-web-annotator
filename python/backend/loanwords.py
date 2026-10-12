"""Dictionary-origin extension. Never infer origins from translated equivalents."""
import re
from backend.offsets import to_utf16

CJK = re.compile(r'[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\U00020000-\U000323af]')
HANGUL = re.compile(r'[\u1100-\u11ff\u3130-\u318f\ua960-\ua97f\uac00-\ud7af\ud7b0-\ud7ff]')

def classify_origin(origin):
    if not isinstance(origin,str) or not origin.strip(): return 'unsupported'
    if any(ord(c)<32 or ord(c)==127 or c in '<>' for c in origin):return 'unsupported'
    if CJK.search(origin) or HANGUL.search(origin):
        return 'mixed' if any(c.isalpha() and not CJK.match(c) and not HANGUL.match(c) for c in origin) else 'unsupported'
    return 'loanword' if any(c.isalpha() for c in origin) else 'unsupported'

def collect(text: str, tokens: list, entries: dict, occupied_ranges: list, *, force_review=False) -> dict:
    """Return UTF-16 annotations/targets; input token and occupied offsets are Python indices.

    Mixed origins always require fixed-choice review, displayed above intact Hangul.
    Only exact tokenizer-form slices qualify. Every entry (including native and
    Hanja homonyms) participates in certainty; KEEP represents other readings.
    """
    annotations=[];targets=[];skipped_mixed=0
    occupied=list(occupied_ranges); seen=set()
    for token in tokens:
        start=token.start;end=start+token.length;form=token.form
        if (start,end) in seen:continue
        seen.add((start,end))
        if getattr(token,'is_particle',False) or getattr(token,'is_punct',False):continue
        if not 0<=start<end<=len(text) or text[start:end]!=form:continue
        if any(start<b and a<end for a,b in occupied):continue
        records=entries.get(form,[])
        loans=[r for r in records if classify_origin(r.get('origin_raw')) in ('loanword','mixed')]
        has_mixed=any(classify_origin(r.get('origin_raw'))=='mixed' for r in loans)
        if not loans:continue
        origins={r['origin_raw'] for r in loans}
        span=dict(start=to_utf16(text,start),end=to_utf16(text,end),surface=form)
        if not force_review and not has_mixed and len(origins)==1 and len(loans)==len(records):
            annotations.append(dict(span,type='loanword',replacement=loans[0]['origin_raw'],entry_id=loans[0].get('id'),definitions=[loans[0]['definition_preview']] if loans[0].get('definition_preview') else []))
        else:
            options=[dict(choice_id='KEEP',type='keep',replacement=form,entry_id=None,definitions=[r['definition_preview'] for r in records if r.get('definition_preview')])]
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
            options[0]['definitions'].extend(target['options'][0].get('definitions',[]))
            for option in target['options'][1:]:
                choice=dict(option)
                choice['choice_id']=f'c{len(options)-1}'
                choice['replacement']=slice16(start,target['start'])+option['replacement']+slice16(target['end'],end)
                options.append(choice)
        merged.append(dict(target_id=f't{i}',start=start,end=end,surface=surface,context=text,options=options))
    return merged
