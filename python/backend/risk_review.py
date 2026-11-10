"""Conservative local-only risk detection; never infer a new word origin.

An exact whole dictionary headword trumps Kiwi's internal segmentation.
Only an unlisted, contiguous, nominal compound with a single-syllable
component and an actual dictionary reading is considered a boundary risk.
All offsets here are Python character offsets; encode only on output.
"""
import re
from backend.proper_nouns import overlaps_proper_noun

HANGUL = re.compile(r'^[가-힣]+$')
TAGS = {'NNG', 'NNP', 'NNB', 'NR', 'XR', 'XPN', 'XSN'}
UNLISTED_TAGS = {'NNG', 'NNP'}

async def uncertain_compounds(text, tokens, lookup, blocked=(), *, include_unlisted=False):
    """Find uncertain nominal lexical boundaries without a vocabulary whitelist.

    Unlisted nominal compounds are potentially lexical words even when Kiwi
    splits them into two or more multi-syllable parts, or tags a part as NNP.
    When experimental resegmentation is active, consider unlisted nominal
    headwords as well. These are *review leads*, not inferred Hanja origins.
    """
    forms = set()
    proposals = []
    singles = []
    ordered = sorted(tokens, key=lambda t: (t.start, -t.length))
    def valid(t):
        a,b=t.start,t.start+t.length
        return (t.length>0 and 0<=a<b<=len(text) and text[a:b]==t.form
                and HANGUL.fullmatch(t.form) and t.tag.split('-')[0] in TAGS)
    def blocked_range(a,b):
        return any(a<stop and start<b for start,stop in blocked)

    # Only use actual source spans: Kiwi stems, inferred lemmas, or overlapping
    # alternative tokenizations cannot establish word boundaries.
    for i,token in enumerate(ordered):
        if not valid(token) or (token.start>0 and '가'<=text[token.start-1]<='힣'):
            continue
        a=token.start
        end=a+token.length
        parts=[token]
        j=i+1
        while j<len(ordered):
            nxt=ordered[j]
            if nxt.start!=end or not valid(nxt) or len(parts)>=12:
                break
            if nxt.start+nxt.length-a>24:
                break
            parts.append(nxt)
            end=nxt.start+nxt.length
            j+=1
        surface=text[a:end]
        if len(parts)>=2 and len(surface)<=24 and not blocked_range(a,end):
            proposals.append((a,end,surface,tuple(p.form for p in parts)))
            forms.add(surface)
            forms.update(p.form for p in parts)
        if (include_unlisted and token.tag.split('-')[0] in UNLISTED_TAGS
                and 2<=len(token.form)<=24 and not blocked_range(a,a+token.length)):
            singles.append((a,a+token.length,token.form))
            forms.add(token.form)
    if not proposals and not singles:
        return []
    entries=await lookup(sorted(forms))
    risks=[]
    compound_ranges=[]
    for a,b,surface,parts in proposals:
        # Any real full headword, including a native one, is better lexical
        # boundary evidence than a guessed concatenation of its subwords.
        if entries.get(surface):
            continue
        compound_ranges.append((a,b))
        risks.append((a,b,surface,'kiwi_split_no_full_headword'))
    if include_unlisted:
        for a,b,surface in singles:
            if entries.get(surface) or any(x<=a and b<=y for x,y in compound_ranges):
                continue
            risks.append((a,b,surface,'unlisted_nominal_headword'))
    # Identical source offsets are one review obligation, regardless of how
    # many tokens or evidence sources discovered the same possible word.
    dedup={}
    for row in risks:
        dedup.setdefault((row[0],row[1]),row)
    return list(sorted(dedup.values(),key=lambda row:(row[0],row[1])))

def weak_unique_candidate(segment, tokens):
    """Require semantic review for uncorroborated short homophones.

    A high local score can mean only that the source spelling, part of speech,
    or dictionary form matched. It cannot show that an unrelated dictionary
    meaning fits this particular sentence. Several senses with the same origin
    are still a *single spelling*, not independent semantic confirmation.

    Keep the risk review narrow to 2-syllable words, and skip only when the
    chosen reading has actual local collocation evidence or an attested
    quantity-unit match. This is a generic rule, never a word whitelist.
    """
    surface = segment.original
    if not HANGUL.fullmatch(surface) or len(surface) != 2:
        return False
    if segment.status != 'converted' or not segment.candidates:
        return False
    candidates = [c for c in segment.candidates
                  if c.get('is_reliable') and c.get('replacement')]
    if not candidates:
        return False
    # Synonymous dictionary records and multiple definitions of one written
    # origin do not make that origin semantically verified in this context.
    writings = {str(c['replacement']) for c in candidates}
    if len(writings) != 1:
        return False
    matched_id = getattr(segment, 'matched_entry_id', None)
    chosen = (next((c for c in candidates
                    if c.get('entry_id') == matched_id), None)
              if matched_id is not None else candidates[0])
    if chosen is None:
        return False
    reason = str(chosen.get('selection_reason') or '')
    if any(marker in reason for marker in ('collocation_match(', 'quantity_unit_bonus')):
        return False
    if any(t.tag.split('-')[0] in {'NNP', 'VV', 'VA', 'VX', 'VCP'}
           and t.start < segment.end and t.start+t.length > segment.start
           for t in tokens):
        return False
    return True


GRAMMAR_TAGS={'JKS','JKC','JKG','JKO','JKB','JKV','JKQ','JX','JC','EP','EF','EC','ETN','ETM'}
def hangul_run(text,start,end):
    """Return the maximal exact contiguous Hangul run around a source span."""
    left=start
    while left>0 and '가'<=text[left-1]<='힣':left-=1
    right=end
    while right<len(text) and '가'<=text[right]<='힣':right+=1
    return left,right

def grammatical_tail(tokens,start,end):
    """Only attested, wholly contiguous particles/endings can complete a word."""
    if start==end:return True
    relevant=sorted((t for t in tokens if t.start>=start and t.start+t.length<=end
                     and t.length>0 and t.tag.split('-')[0] in GRAMMAR_TAGS),
                    key=lambda t:(t.start,-t.length))
    cursor=start
    for token in relevant:
        if token.start==cursor:cursor+=token.length
        elif token.start<cursor:continue
        else:return False
        if cursor==end:return True
    return False

def unverified_word_boundary(text,start,end,tokens):
    """Do not accept a dictionary subword as the whole lexical item.

    An exactly matching word followed by real grammatical particles is safe;
    an unlisted lexical continuation (even with an incorrect Kiwi POS) is not.
    """
    if not 0<=start<end<=len(text) or not HANGUL.fullmatch(text[start:end]):
        return False
    left,right=hangul_run(text,start,end)
    if left==start and (right==end or grammatical_tail(tokens,end,right)):
        return False
    return True
