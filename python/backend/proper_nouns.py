"""Kiwi proper-noun spans are review hints, never proof of a name's origin."""
import re

def proper_noun_ranges(tokens):
    return [(t.start,t.start+t.length) for t in tokens if getattr(t,'tag','').split('-')[0]=='NNP']

def overlaps_proper_noun(start,end,ranges):
    return any(start<b and a<end for a,b in ranges)

async def surname_name_evidence(text,tokens,lookup):
    """Protect unknown surnames, but review complete ordinary homographs when structural evidence is strong."""
    spans=[]
    for i,token in enumerate(tokens):
        if token.tag.split('-')[0] not in {'NNG','NNP','NR'} or token.length<=0:continue
        start=token.start
        if start and re.match(r'[가-힣]',text[start-1]):continue
        end=start;parts=[];j=i
        while j<len(tokens):
            t=tokens[j]
            if t.tag.split('-')[0] not in {'NNG','NNP','NR'} or t.start!=end or t.length<=0 or text[t.start:t.start+t.length]!=t.form:break
            parts.append(t);end=t.start+t.length;j+=1
        word=text[start:end]
        if not 2<=len(word)<=4 or not re.fullmatch(r'[가-힣]+',word):continue
        if j>=len(tokens) or tokens[j].start!=end:continue
        suffix=tokens[j]
        case=suffix.tag.startswith('J')
        mistagged_case=(suffix.tag=='MM' and suffix.form=='이' and
                        text[suffix.start:suffix.start+suffix.length]=='이' and
                        (j+1==len(tokens) or tokens[j+1].start>suffix.start+suffix.length))
        if not (case or mistagged_case):continue
        spans.append((start,end,word,parts))
    if not spans:return [],[]
    forms={f for _,_,word,parts in spans for f in (word,word[:1],word[:2],*(t.form for t in parts))}
    entries=await lookup(list(forms))
    names=set();ranges=[];ambiguous=[]
    for start,end,word,parts in spans:
        if parts[0].tag.split('-')[0]=='NR' and any(r.get('unit_usage') is True for t in parts[1:] for r in entries.get(t.form,[])):continue
        split_hint=len(parts)>1 and parts[0].tag.split('-')[0]=='NNP' and len(parts[0].form)<=2
        surname=any(r.get('surname_usage') is True for prefix in (word[:1],word[:2]) if len(prefix)<len(word) for r in entries.get(prefix,[]))
        if split_hint or surname:
            full_entries=entries.get(word,[])
            if full_entries:
                # One surname syllable in a normal whole-word token cannot trigger review.
                confirmed_structure=(split_hint or (surname and len(parts)>1) or
                    (surname and parts[0].tag.split('-')[0]=='NNP'))
                if confirmed_structure and any(is_dictionary_ordinary(r) for r in full_entries):
                    ambiguous.append((start,end,word,full_entries))
                continue
            names.add(word);ranges.append((start,end))
    for word in names:
        for match in re.finditer(r'(?<![가-힣])'+re.escape(word)+r'(?![가-힣])',text):ranges.append(match.span())
    return sorted(set(ranges)),sorted(ambiguous,key=lambda r:(r[0],r[1]))

async def name_ranges(text,tokens,lookup):
    return (await surname_name_evidence(text,tokens,lookup))[0]

# Dictionary exports sometimes omit an explicit personal-name category even
# when their definition is a full biographical entry. Demand BOTH a lifespan
# and a human role in the opening gloss; ordinary "general name" nouns and
# works merely mentioning a person must not be removed.
_LIFESPAN=re.compile(r'[(（]\s*(?:(?:[Bb]\.?[Cc]\.?\s*)?\d{1,4}|\?)\s*[~～–-]\s*\??\d{1,4}\s*[)）]')
_PERSON_ROLE=re.compile(r'(?:장군|독립운동가|정치가|정치인|문신|무신|황제|국왕|왕|제독|학자|과학자|철학자|사상가|작곡가|화가|소설가|시인|작가|극작가|음악가|연주가|가수|배우|감독|군인|승려|성직자|외교관|혁명가|발명가|탐험가|운동가|대통령|총리|장관|교수|기자|수학자|천문학자|의학자|박물학자|종교인)')
_CATEGORY_PERSON=re.compile(r'(?<!\w)(?:인명|人名|personal name)(?!\w)',re.I)

def is_person_biography(definition):
    if not isinstance(definition,str):return False
    opening=definition[:200]
    lifespan=_LIFESPAN.search(opening)
    return bool(lifespan and _PERSON_ROLE.search(opening[:lifespan.start()]))

def is_dictionary_person(record):
    if not isinstance(record,dict):return False
    if record.get('dictionary_person') is True:return True
    if any(_CATEGORY_PERSON.search(str(record.get(key) or ''))
           for key in ('subject_category','semantic_category')):return True
    definitions=record.get('definitions') or []
    if isinstance(definitions,str):definitions=[definitions]
    preview=record.get('definition_preview')
    return any(is_person_biography(definition) for definition in
               ([preview] if preview else [])+list(definitions))


def is_dictionary_ordinary(record):
    if is_dictionary_person(record):return False
    pos=str(record.get('part_of_speech') or '')
    if re.search(r'고유\s*명사|固有名[詞词]|proper\s+noun',pos,re.I):return False
    category=' '.join(str(record.get(k) or '') for k in ('subject_category','semantic_category'))
    if re.search(r'지명|地名|place\s+name|기관명|機關名|机构名|단체명|團體名|团体名|organization\s+name',category,re.I):return False
    return True

def _complete_lexical_span(text,tokens,start,end):
    if start>0 and '가'<=text[start-1]<='힣':return False
    if end>=len(text) or not ('가'<=text[end]<='힣'):return True
    for i,part in enumerate(tokens):
        if part.start!=end:continue
        tag=part.tag.split('-')[0]
        if tag.startswith('J'):return True
        q=part.start+part.length
        return part.tag=='MM' and part.form=='이' and (i+1==len(tokens) or tokens[i+1].start>q)
    return False

async def dictionary_name_evidence(text,tokens,lookup):
    from backend.mixed_origins import candidate_spans
    spans=candidate_spans(text,tokens)
    entries=await lookup(list(dict.fromkeys(word for _,_,word in spans))) if spans else {}
    names=[];conflicts=[]
    for a,b,word in spans:
        records=entries.get(word,[])
        if not any(is_dictionary_person(r) for r in records):continue
        names.append((a,b))
        person_ids={r.get('entry_id',r.get('id')) for r in records if is_dictionary_person(r)}
        if (any(is_dictionary_ordinary(r) and r.get('entry_id',r.get('id')) not in person_ids for r in records)
                and _complete_lexical_span(text,tokens,a,b)):
            conflicts.append((a,b,word,records))
    pure=[span for span in names if all(span!=(a,b) for a,b,_,_ in conflicts)]
    conflicts=[c for c in sorted(conflicts,key=lambda x:(-len(x[2]),x[0]))
               if not any(a<c[1] and c[0]<b and (a<=c[0] and c[1]<=b) for a,b in pure)]
    chosen=[]
    for item in conflicts:
        if not any(item[0]<existing[1] and existing[0]<item[1] for existing in chosen):chosen.append(item)
    return names,sorted(chosen,key=lambda x:(x[0],x[1]))

async def dictionary_name_ranges(text,tokens,lookup):
    return (await dictionary_name_evidence(text,tokens,lookup))[0]
