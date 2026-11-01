"""Exact whole-entry foreign/Hanja compounds, with unique source segmentation.

No transliteration or dictionary-free suffix guesses. Each Hanja character
consumes one source syllable; native anchors must match verbatim; Latin runs
consume an unknown positive number of syllables. Accept only a unique full map.
"""
import re
from backend.offsets import to_utf16
from backend.loanwords import CJK
from backend.proper_nouns import proper_noun_ranges, overlaps_proper_noun

HANGUL=re.compile(r'^[가-힣]+$')
LATIN=re.compile(r'[A-Za-zÀ-ÖØ-öø-ÿ]')
LEXICAL={'NNG','NNP','NNB','NR','XR','XPN','XSN'}

def align_mixed(surface, origin):
    if not HANGUL.fullmatch(surface) or len(surface)>80 or not isinstance(origin,str):return None
    origin=origin.strip()
    if not CJK.search(origin) or not LATIN.search(origin):return None
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

async def collect_mixed(engine,text,tokens,modes):
    spans=candidate_spans(text,tokens)
    proper_ranges=proper_noun_ranges(tokens)
    entries=await engine.lookup_entries([form for _,_,form in spans])
    annotations=[];targets=[];ranges=[];skipped=0
    for start,end,word in spans:
        if any(start<b and a<end for a,b in ranges):continue
        records=entries.get(word,[]);options=[];mapped=0;signatures=set();unaligned=False
        for record in records:
            parts=align_mixed(word,record.get('origin_raw'))
            if parts is None:
                raw=record.get('origin_raw') or ''
                if CJK.search(raw) and LATIN.search(raw):unaligned=True
                continue
            mapped+=1
            selected=[p for p in parts if (p['type']=='hanja' and modes.get('hanja',True)) or (p['type']=='loanword' and modes.get('loanword',False))]
            if not selected:continue
            replacement=word
            for p in reversed(selected):replacement=replacement[:p['start']]+p['replacement']+replacement[p['end']:]
            signature=(replacement,tuple((p['start'],p['end'],p['type'],p['replacement']) for p in selected))
            if signature in signatures:continue
            signatures.add(signature)
            segments=[{**p,'start':to_utf16(word,p['start']),'end':to_utf16(word,p['end'])} for p in selected]
            options.append(dict(choice_id=f'm{len(options)}',type=segments[0]['type'] if len(segments)==1 else 'mixed',replacement=replacement,segments=segments,entry_id=record['id'],definitions=[record['definition_preview']] if record.get('definition_preview') else []))
        if unaligned:skipped+=1
        if not options:continue
        ranges.append((start,end))
        # Every whole-entry reading must support the same complete written origin.
        certain=len(options)==1 and mapped==len(records) and all(r.get('part_of_speech')=='명사' for r in records)
        if certain and not modes.get('reviewAll',False) and not overlaps_proper_noun(start,end,proper_ranges):
            for p in options[0]['segments']:
                annotations.append({**p,'start':to_utf16(text,start)+p['start'],'end':to_utf16(text,start)+p['end']})
        else:
            keep=dict(choice_id='KEEP',type='keep',replacement=word,entry_id=None,definitions=[r['definition_preview'] for r in records if r.get('definition_preview')])
            targets.append(dict(target_id=f'mixed{len(targets)}',start=to_utf16(text,start),end=to_utf16(text,end),surface=word,context=text,options=[keep]+options))
    return dict(annotations=annotations,targets=targets,ranges=ranges,skipped_mixed=skipped)
