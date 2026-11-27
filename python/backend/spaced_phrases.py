"""Conservative complete-Hanja phrase alignment preserving source spaces.

For source 이산화 탄소 and lexical origin 二酸化炭素, create two
independently alignable Hanja segments and display 二酸化 炭素.
Do not invent how Latin words split across a space or join source ranges.
"""
import re
from backend.offsets import to_utf16
from backend.loanwords import CJK

SPACED_WORD = re.compile(r'^[가-힣]+(?: [가-힣]+){1,3}$')

def spaced_hanja_option(surface,record):
    if not SPACED_WORD.fullmatch(surface):
        return None
    origin=record.get('origin_raw')
    if not isinstance(origin,str):
        return None
    chunks=surface.split(' ')
    if not origin or not all(CJK.fullmatch(char) for char in origin):
        return None
    if sum(len(chunk) for chunk in chunks)!=len(origin):
        return None
    pos=0
    hanja_index=0
    segments=[]
    converted=[]
    for chunk in chunks:
        offset=surface.index(chunk,pos)
        replacement=origin[hanja_index:hanja_index+len(chunk)]
        hanja_index+=len(chunk)
        segments.append(dict(start=to_utf16(surface,offset),end=to_utf16(surface,offset+len(chunk)),
                             surface=chunk,type='hanja',replacement=replacement))
        converted.append(replacement)
        pos=offset+len(chunk)
    return dict(type='hanja',replacement=' '.join(converted),segments=segments,
                entry_id=record.get('id',record.get('entry_id')),
                definitions=[record.get('definition_preview')] if record.get('definition_preview') else [])

async def add_spaced_hanja_candidates(engine,text,tokens,spans,targets,annotations,guarded):
    """Query explicitly spaced dictionary titles, never create a cross-space target.

    Existing local annotations are not replaced. If a word is already partly
    covered, project only the missing ranges or add choices to existing targets.
    All derived choices carry the full phrase origin and original dictionary ID.
    """
    from itertools import product
    from bisect import bisect_left
    from backend.proper_nouns import is_dictionary_person
    from backend.analysis import _SpanIndex

    # Whole source words, plus a final lexical stem before an attached particle.
    # Only a single literal space may connect neighboring words.
    lexical={(a,b) for a,b,_ in spans}
    particle_starts={t.start for t in tokens if t.tag.split('-')[0].startswith('J')}
    ends={}
    for a,b in lexical:
        if b in particle_starts:
            ends.setdefault(a,[]).append(b)
    runs=list(re.finditer(r'[가-힣]+',text))
    guards=_SpanIndex(guarded)
    occurrences={}
    for i,first in enumerate(runs):
        start=first.start()
        for j in range(i+1,min(i+4,len(runs))):
            previous,current=runs[j-1],runs[j]
            if text[previous.end():current.start()]!=' ' or (previous.start(),previous.end()) not in lexical:
                break
            for end in sorted(set([current.end(),*ends.get(current.start(),())])):
                if (current.start(),end) not in lexical or end>current.end():
                    continue
                surface=text[start:end]
                if len(surface.replace(' ',''))>16 or guards.overlaps(start,end):
                    continue
                occurrences.setdefault(surface,[]).append(start)
    if not occurrences:return

    # Limit SQL probes to the observed boundaries (at most 2**3 variants).
    # A merely contiguous title is not proof of an independently spaced phrase.
    by_surface={}
    keys=set()
    for surface in occurrences:
        parts=surface.split(' ')
        aliases=[''.join(p+(seps[i] if i<len(seps) else '') for i,p in enumerate(parts))
                 for seps in product((' ','^'),repeat=len(parts)-1)]
        by_surface[surface]=aliases
        keys.update(aliases)
    rows=await engine.dictionary.batch_lookup_entries(sorted(keys),exact=True)

    # Index the existing nonoverlapping ranges once. Newly derived ranges are
    # partitioned along the existing boundaries, so no normal target is retired.
    old=sorted([('annotation',a) for a in annotations]+[('target',t) for t in targets],
               key=lambda item:(item[1]['start'],item[1]['end']))
    starts=[item[1]['start'] for item in old]
    additions={}
    added_ranges=_SpanIndex(())
    proposals={}
    for surface,positions in occurrences.items():
        for key in by_surface[surface]:
            for record in rows.get(key,[]):
                if is_dictionary_person(record):continue
                option=spaced_hanja_option(surface,record)
                if not option:continue
                entry=option['entry_id']
                for pos in positions:
                    base=to_utf16(text,pos)
                    for segment in option['segments']:
                        a=base+segment['start'];b=base+segment['end']
                        proposals.setdefault((a,b,segment['surface']),[]).append(
                            (segment['replacement'],entry,surface,record['origin_raw'],record.get('definition_preview')))
    for (a,b,word),choices in sorted(proposals.items()):
        i=bisect_left(starts,a)
        while i>0 and old[i-1][1]['end']>a:i-=1
        covered=[]
        while i<len(old) and old[i][1]['start']<b:
            kind,item=old[i];i+=1
            if item['end']>a:covered.append((kind,item))
        # Never split or overwrite a target extending beyond this source word.
        if any(item['start']<a or item['end']>b for _,item in covered):continue
        if any(item.get('dictionary_person_name') or item.get('dictionary_name_homograph')
               or item.get('suspected_person_name') for _,item in covered):continue
        for replacement,entry,phrase,origin,definition in choices:
            # A conflicting already-fixed local result is not silently changed.
            if any(kind=='annotation' and item['replacement']!=replacement[item['start']-a:item['end']-a]
                   for kind,item in covered):continue
            parts=[]
            cursor=a
            for kind,item in covered:
                x,y=item['start'],item['end']
                if x<cursor:
                    parts=[];break
                if cursor<x:parts.append((cursor,x,None))
                if kind=='target':parts.append((x,y,item))
                cursor=y
            else:
                if cursor<b:parts.append((cursor,b,None))
            for x,y,target in parts:
                # All source characters in this range are BMP Hangul, so
                # UTF-16-relative indices equal code-point indices here.
                piece=word[x-a:y-a];converted=replacement[x-a:y-a]
                if target is None:
                    target=additions.get((x,y))
                    if target is None:
                        if added_ranges.overlaps(x,y):continue
                        target=dict(start=x,end=y,surface=piece,context=text,
                            options=[dict(choice_id=None,type='keep',replacement=piece,entry_id=None,definitions=[])])
                        additions[x,y]=target
                        added_ranges.add(x,y)
                options=target['options']
                evidence=f'{phrase} ({origin})'
                if any(o.get('entry_id')==entry and o.get('replacement')==converted
                       and o.get('phrase_origin')==evidence for o in options):continue
                options.append(dict(choice_id='phrase-dictionary',type='hanja',replacement=converted,
                    entry_id=entry,definitions=[definition] if definition else [],phrase_origin=evidence))
    targets.extend(additions.values())
