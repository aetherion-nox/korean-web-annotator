"""Kiwi proper-noun spans are review hints, never proof of a name's origin."""
import re

def proper_noun_ranges(tokens):
    return [(t.start,t.start+t.length) for t in tokens if getattr(t,'tag','').split('-')[0]=='NNP']

def overlaps_proper_noun(start,end,ranges):
    return any(start<b and a<end for a,b in ranges)

async def name_ranges(text,tokens,lookup):
    """Protect an unknown, case-marked name as a whole; never guess its Hanja.

    A split NNP prefix or an explicit dictionary surname reading supplies the
    name evidence. An existing whole dictionary word is counterevidence to
    this heuristic, including ordinary compounds beginning with a surname.
    """
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
        # Kiwi sometimes labels attached subject 이 as a determiner after a
        # split name. It must end this whitespace-delimited word, not prefix
        # another attached nominal; surname/NNP evidence is still required.
        mistagged_case=(suffix.tag=='MM' and suffix.form=='이' and
                        text[suffix.start:suffix.start+suffix.length]=='이' and
                        (j+1==len(tokens) or tokens[j+1].start>suffix.start+suffix.length))
        if not (case or mistagged_case):continue
        spans.append((start,end,word,parts))
    if not spans:return []
    forms={f for _,_,word,parts in spans for f in (word,word[:1],word[:2],*(t.form for t in parts))}
    entries=await lookup(list(forms))
    names=set();ranges=[]
    for start,end,word,parts in spans:
        if entries.get(word):continue
        # A number followed by an explicitly documented unit is counterevidence
        # to a name guess, even when the numeral is also a dictionary surname.
        if parts[0].tag.split('-')[0]=='NR' and any(r.get('unit_usage') is True for t in parts[1:] for r in entries.get(t.form,[])):continue
        split_hint=len(parts)>1 and parts[0].tag.split('-')[0]=='NNP' and len(parts[0].form)<=2
        surname=any(r.get('surname_usage') is True for prefix in (word[:1],word[:2]) if len(prefix)<len(word) for r in entries.get(prefix,[]))
        if split_hint or surname:
            names.add(word);ranges.append((start,end))
    # Repeated bare mentions use evidence established in this same input only.
    for word in names:
        for match in re.finditer(r'(?<![가-힣])'+re.escape(word)+r'(?![가-힣])',text):ranges.append(match.span())
    return sorted(set(ranges))


def is_dictionary_person(record):
    """Only explicit dictionary classifications establish a person-name entry."""
    return any(re.search(r'(?<!\w)(?:인명|人名|personal name)(?!\w)', str(record.get(key) or ''), re.I)
               for key in ('subject_category','semantic_category'))

async def dictionary_name_ranges(text,tokens,lookup):
    # Reuse the same bounded lexical spans and cached candidate lookup as the
    # whole-entry path. This also catches names split into ordinary nouns.
    from backend.mixed_origins import candidate_spans
    spans=candidate_spans(text,tokens)
    entries=await lookup(list(dict.fromkeys(word for _,_,word in spans))) if spans else {}
    return [(a,b) for a,b,word in spans if any(is_dictionary_person(r) for r in entries.get(word,[]))]
