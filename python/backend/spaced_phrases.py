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

def _aligned_parts(surface,origin):
    """Map a complete origin without guessing a split inside foreign spelling."""
    from backend.mixed_origins import _align_origin,align_mixed,is_mixed_origin,LATIN
    from backend.loanwords import classify_origin
    if is_mixed_origin(origin):
        return align_mixed(surface,origin)
    if classify_origin(origin)=='loanword' and LATIN.search(origin):
        return [dict(start=0,end=len(surface),surface=surface,type='loanword',replacement=origin)]
    return _align_origin(surface,origin)

def _slice_parts(parts,word,start,end):
    """Cut fixed-width Hanja/native runs; never cut a foreign run."""
    result=[]
    for part in parts:
        a=max(start,part['start']);b=min(end,part['end'])
        if a>=b:continue
        if part['type']=='loanword':
            if a!=part['start'] or b!=part['end']:return None
            replacement=part['replacement']
        else:
            replacement=part['replacement'][a-part['start']:b-part['start']]
        result.append(dict(start=a-start,end=b-start,surface=word[a-start:b-start],
                           type=part['type'],replacement=replacement))
    return result

def align_phrase(title,origin):
    if not isinstance(title,str) or not isinstance(origin,str) or not origin.strip():return None
    if any(ord(c)<32 or ord(c)==127 or c in '<>' for c in origin):return None
    if not re.fullmatch(r'[가-힣]+(?:[ ^-][가-힣]+){1,3}',title):return None
    words=tuple(re.split('[ ^-]',title))
    surface=''.join(words)
    if len(surface)>16:return None
    # Explicit foreign word boundaries may establish a one-to-one ordered
    # component map. Without boundaries, a Latin run is indivisible.
    chunks=origin.split()
    if len(chunks)==len(words):
        parts=[]
        for word,chunk in zip(words,chunks):
            aligned=_aligned_parts(word,chunk)
            if aligned is None:break
            parts.append(aligned)
        if len(parts)==len(words):return words,parts
    from backend.mixed_origins import _align_origin,align_mixed,is_mixed_origin
    # A pure foreign run without explicit boundaries is ambiguous across words.
    if not CJK.search(origin) and not any('가'<=c<='힣' for c in origin):return None
    full=align_mixed(surface,origin) if is_mixed_origin(origin) else _align_origin(surface,origin)
    if full is None:return None
    parts=[];start=0
    for word in words:
        end=start+len(word)
        aligned=_slice_parts(full,surface,start,end)
        if aligned is None:return None
        parts.append(aligned);start=end
    return words,parts

class PhraseIndex:
    """Read-only per-dictionary-engine index, no extra SQL probes per phrase."""
    def __init__(self,records):
        from collections import defaultdict
        from backend.proper_nouns import is_dictionary_person
        self.phrases=defaultdict(list);self.children=defaultdict(list)
        for record in records:
            if is_dictionary_person(record):continue
            origin=record['origin_raw']
            aligned=align_phrase(record['written_form'],origin)
            if aligned is None:continue
            words,parts=aligned
            if not any(p['type'] in ('hanja','loanword') for group in parts for p in group):continue
            entry=record['id'];evidence=f"{' '.join(words)} ({origin})"
            self.phrases[words].append((entry,evidence,parts))
            for word,group in zip(words,parts):
                if any(p['type'] in ('hanja','loanword') for p in group):
                    self.children[word].append((entry,evidence,group))

def _project_option(word,parts,modes):
    selected=[p for p in parts if (p['type']=='hanja' and modes.get('hanja',True)) or
                                (p['type']=='loanword' and modes.get('loanword',False))]
    if not selected:return None
    replacement=word
    for p in reversed(selected):
        replacement=replacement[:p['start']]+p['replacement']+replacement[p['end']:]
    kind=selected[0]['type'] if len({p['type'] for p in selected})==1 else 'mixed'
    option=dict(type=kind,replacement=replacement)
    if len(selected)!=1 or selected[0]['start']!=0 or selected[0]['end']!=len(word):
        option['segments']=selected
    return option

async def add_spaced_hanja_candidates(engine,text,tokens,spans,targets,annotations,guarded,modes):
    """Full phrase and orphan-component review choices, never cross spaces."""
    from bisect import bisect_left
    from backend.proper_nouns import is_dictionary_person
    from backend.analysis import _SpanIndex
    lexical={(a,b) for a,b,_ in spans}
    particle_starts={t.start for t in tokens if t.tag.split('-')[0].startswith('J')}
    ends={}
    for a,b in lexical:
        if b in particle_starts:ends.setdefault(a,[]).append(b)
    runs=list(re.finditer(r'[가-힣]+',text))
    guards=_SpanIndex(guarded)
    words=[]
    for run in runs:
        a=run.start()
        words.append([(a,b,text[a:b]) for b in sorted(set([run.end(),*ends.get(a,())]),reverse=True)
                      if (a,b) in lexical and b<=run.end() and not guards.overlaps(a,b)])
    if not any(words):return
    index=await engine.dictionary.load_phrase_index()
    if not index.children:return
    proposals={};matched=set()
    def propose(a,b,word,entry,evidence,parts):
        key=(to_utf16(text,a),to_utf16(text,b),word)
        proposals.setdefault(key,[]).append((entry,evidence,parts))
    for i,first in enumerate(words):
        if not first:continue
        prefix=[]
        for j in range(i,min(i+4,len(runs))):
            if j>i and (text[runs[j-1].end():runs[j].start()]!=' ' or
                        not words[j-1] or words[j-1][0][1]!=runs[j-1].end()):break
            if not words[j]:break
            for a,b,word in words[j]:
                group=prefix+[word]
                if len(group)<2:continue
                for entry,evidence,parts in index.phrases.get(tuple(group),()):
                    positions=[words[k][0] for k in range(i,j)]+[(a,b,word)]
                    if guards.overlaps(positions[0][0],b):continue
                    for (x,y,w),part in zip(positions,parts):
                        matched.add((x,y,w))
                        propose(x,y,w,entry,evidence,part)
            prefix.append(words[j][0][2])
    # Missing standalone dictionary entry only: do not turn an ordinary native
    # homograph or existing dictionary sense into a new fallback automatically.
    orphan=[(a,b,w) for group in words for a,b,w in group
            if (a,b,w) not in matched and w in index.children]
    direct=await engine.lookup_entries([w for _,_,w in orphan]) if orphan else {}
    for a,b,word in orphan:
        if direct.get(word):continue
        for entry,evidence,parts in index.children[word]:
            propose(a,b,word,entry,evidence,parts)
    if not proposals:return
    ids=list(dict.fromkeys(entry for choices in proposals.values() for entry,_,_ in choices))
    definitions=await engine.cached_definitions(ids)
    metadata=await engine.cached_metadata(ids)
    people={entry for entry in ids if is_dictionary_person({**metadata.get(entry,{}),'definitions':definitions.get(entry,[])})}
    old=sorted([('annotation',a) for a in annotations]+[('target',t) for t in targets],
               key=lambda item:(item[1]['start'],item[1]['end']))
    starts=[item[1]['start'] for item in old];additions={};added_ranges=_SpanIndex(())
    for (a,b,word),choices in sorted(proposals.items(),key=lambda item:(item[0][0],-item[0][1])):
        i=bisect_left(starts,a)
        while i>0 and old[i-1][1]['end']>a:i-=1
        covered=[]
        while i<len(old) and old[i][1]['start']<b:
            kind,item=old[i];i+=1
            if item['end']>a:covered.append((kind,item))
        if any(item['start']<a or item['end']>b for _,item in covered):continue
        if any(item.get('dictionary_person_name') or item.get('dictionary_name_homograph')
               or item.get('suspected_person_name') for _,item in covered):continue
        ranges=[];cursor=a
        for kind,item in covered:
            x,y=item['start'],item['end']
            if x<cursor:break
            if cursor<x:ranges.append((cursor,x,None))
            if kind=='target':ranges.append((x,y,item))
            cursor=y
        else:
            if cursor<b:ranges.append((cursor,b,None))
            for entry,evidence,parts in choices:
                if entry in people:continue
                # A fixed local result must agree with the same projected
                # component; no incompatible or split Latin alternatives.
                compatible=True
                for kind,item in covered:
                    if kind!='annotation':continue
                    projected=_slice_parts(parts,word,item['start']-a,item['end']-a)
                    option=_project_option(item['surface'],projected,modes) if projected is not None else None
                    if option is None or option['replacement']!=item['replacement'] or option['type']!=item['type']:
                        compatible=False;break
                if not compatible:continue
                for x,y,target in ranges:
                    piece=word[x-a:y-a];aligned=_slice_parts(parts,word,x-a,y-a)
                    option=_project_option(piece,aligned,modes) if aligned is not None else None
                    if option is None:continue
                    if target is None:
                        target=additions.get((x,y))
                        if target is None:
                            if added_ranges.overlaps(x,y):continue
                            target=dict(start=x,end=y,surface=piece,context=text,
                                options=[dict(choice_id=None,type='keep',replacement=piece,entry_id=None,definitions=[])])
                            additions[x,y]=target;added_ranges.add(x,y)
                    options=target['options']
                    if any(o.get('entry_id')==entry and o.get('replacement')==option['replacement']
                           and o.get('phrase_origin')==evidence for o in options):continue
                    options.append(dict(choice_id='phrase-dictionary',**option,
                        entry_id=entry,definitions=definitions.get(entry,[]),phrase_origin=evidence))
    targets.extend(additions.values())
