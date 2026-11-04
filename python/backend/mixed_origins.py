"""Exact whole-entry mixed and cross-origin readings with unique segmentation.

No transliteration or dictionary-free suffix guesses. Each Hanja character
consumes one source syllable; native anchors must match verbatim; Latin runs
consume an unknown positive number of syllables. Accept only a unique full map.
"""
import re
from backend.offsets import to_utf16
from backend.loanwords import CJK, classify_origin, nonconversion_options
from backend.proper_nouns import proper_noun_ranges, overlaps_proper_noun

HANGUL=re.compile(r'^[가-힣]+$')
LATIN=re.compile(r'[A-Za-zÀ-ÖØ-öø-ÿ]')
NATIVE_SYLLABLE=re.compile(r'[가-힣]')
LEXICAL={'NNG','NNP','NNB','NR','XR','XPN','XSN','MM'}

def _align_origin(surface, origin):
    if not HANGUL.fullmatch(surface) or len(surface)>80 or not isinstance(origin,str):return None
    origin=origin.strip()
    units=[];i=0
    while i<len(origin):
        c=origin[i]
        if c.isspace():i+=1;continue
        if c=='/' and units:
            # MDX adapters may separate unlike origin items as 'game / 機'.
            # Same-script slash alternatives such as '機/器' stay unsupported.
            tail=origin[i+1:].lstrip()
            next_kind='hanja' if tail and CJK.fullmatch(tail[0]) else 'loanword' if tail and LATIN.fullmatch(tail[0]) else None
            if next_kind and {units[-1][0],next_kind}=={'hanja','loanword'}:
                i+=1;continue
            return None
        kind='hanja' if CJK.fullmatch(c) else 'native' if '가'<=c<='힣' else 'loanword' if LATIN.fullmatch(c) else None
        if kind is None:return None
        j=i+1
        while j<len(origin):
            nxt=origin[j]
            if kind=='hanja' and CJK.fullmatch(nxt):j+=1
            elif kind=='native' and '가'<=nxt<='힣':j+=1
            elif kind=='loanword' and (LATIN.fullmatch(nxt) or nxt in " -'’." or nxt.isdigit()):j+=1
            else:break
        units.append((kind,origin[i:j].strip()));i=j
    if len(units)>16:return None
    solutions=[]
    def visit(index,pos,parts):
        if len(solutions)>1:return
        if index==len(units):
            if pos==len(surface):solutions.append(parts)
            return
        kind,value=units[index]
        minimum=sum(1 if k=='loanword' else len(v) for k,v in units[index+1:])
        lengths=range(1,len(surface)-pos-minimum+1) if kind=='loanword' else [len(value)]
        for size in lengths:
            end=pos+size
            if end>len(surface):continue
            if kind=='native' and surface[pos:end]!=value:continue
            visit(index+1,end,parts+[dict(start=pos,end=end,surface=surface[pos:end],type=kind,replacement=value)])
    visit(0,0,[])
    return solutions[0] if len(solutions)==1 else None

def is_mixed_origin(origin):
    return isinstance(origin,str) and bool(CJK.search(origin)) and bool(LATIN.search(origin) or NATIVE_SYLLABLE.search(origin))

def align_mixed(surface, origin):
    if not is_mixed_origin(origin):return None
    return _align_origin(surface,origin)

def candidate_spans(text,tokens):
    spans=set()
    for i,token in enumerate(tokens):
        if token.tag.split('-')[0] not in LEXICAL:continue
        start=token.start;end=start
        for nxt in tokens[i:i+8]:
            if nxt.tag.split('-')[0] not in LEXICAL or nxt.start!=end:break
            end=nxt.start+nxt.length
            if HANGUL.fullmatch(text[start:end]):spans.add((start,end,text[start:end]))
    return sorted(spans,key=lambda r:(r[0],-r[1]))

async def collect_mixed(engine,text,tokens,modes,*,whole_word_ranges=()):
    spans=candidate_spans(text,tokens)
    proper_ranges=proper_noun_ranges(tokens)
    entries=await engine.lookup_entries([form for _,_,form in spans])
    annotations=[];targets=[];ranges=[];skipped=0
    for start,end,word in spans:
        # Respect the original converter's longer whole-word match, including
        # native whole words. Equal spans are still unified here.
        if any(a<=start and end<=b and (a<start or end<b) for a,b in whole_word_ranges):continue
        if any(start<b and a<end for a,b in ranges):continue
        records=entries.get(word,[]);options=[];mapped=0;signatures=set();unaligned=False;has_mixed=False;origin_kinds=set()
        for record in records:
            raw=record.get('origin_raw')
            if not isinstance(raw,str):continue
            if is_mixed_origin(raw):
                kind='mixed';has_mixed=True
                parts=align_mixed(word,raw)
                if parts is None:unaligned=True
            elif not CJK.search(raw) and classify_origin(raw) in ('loanword','mixed'):
                kind='loanword'
                # Preserve the normal loanword path's whole-entry spelling.
                parts=[dict(start=0,end=len(word),surface=word,type='loanword',replacement=raw)]
            else:
                kind='hanja' if CJK.search(raw) else 'native'
                parts=_align_origin(word,raw)
            # An unusable sibling still competes semantically and must prevent
            # local certainty; only its unsafe conversion option is omitted.
            if kind!='native':origin_kinds.add(kind)
            if parts is None:continue
            selected=[p for p in parts if (p['type']=='hanja' and modes.get('hanja',True)) or (p['type']=='loanword' and modes.get('loanword',False))]
            if not selected:continue
            mapped+=1
            replacement=word
            for p in reversed(selected):replacement=replacement[:p['start']]+p['replacement']+replacement[p['end']:]
            signature=(replacement,tuple((p['start'],p['end'],p['type'],p['replacement']) for p in selected))
            signatures.add(signature)
            segments=[{**p,'start':to_utf16(word,p['start']),'end':to_utf16(word,p['end'])} for p in selected]
            options.append(dict(choice_id=f'm{len(options)}',type=segments[0]['type'] if len(segments)==1 else 'mixed',replacement=replacement,segments=segments,entry_id=record['id'],definitions=[record['definition_preview']] if record.get('definition_preview') else []))
        if unaligned:skipped+=1
        # Mixed and cross-origin whole words share one complete choice set,
        # even when the tokenizer split their exact dictionary headword.
        # Single-origin ordinary words keep the original scoring path.
        if not (has_mixed or len(origin_kinds)>1):continue
        ranges.append((start,end))
        # No enabled safe conversion remains: keep Korean without sending a
        # native-only task, and prevent the generic fallback from reviving it.
        if not options:continue
        # Every whole-entry reading must support the same complete written origin.
        certain=len(signatures)==1 and mapped==len(records) and all(r.get('part_of_speech')=='명사' for r in records)
        if certain and not modes.get('reviewAll',False) and not overlaps_proper_noun(start,end,proper_ranges):
            for p in options[0]['segments']:
                annotations.append({**p,'start':to_utf16(text,start)+p['start'],'end':to_utf16(text,start)+p['end']})
        else:
            keep=dict(choice_id='KEEP',type='keep',replacement=word,entry_id=None,definitions=[])
            native=nonconversion_options(word,records,hanja=modes.get('hanja',True),loanword=modes.get('loanword',False))
            targets.append(dict(target_id=f'mixed{len(targets)}',start=to_utf16(text,start),end=to_utf16(text,end),surface=word,context=text,options=[keep]+native+options))
    return dict(annotations=annotations,targets=targets,ranges=ranges,skipped_mixed=skipped)
