"""Conservative local-only risk detection; never infer a new word origin.

An exact whole dictionary headword trumps Kiwi's internal segmentation.
Only an unlisted, contiguous, nominal compound with a single-syllable
component and an actual dictionary reading is considered a boundary risk.
All offsets here are Python character offsets; encode only on output.
"""
import re
from backend.proper_nouns import overlaps_proper_noun

HANGUL = re.compile(r'^[가-힣]+$')
TAGS = {'NNG', 'NNB', 'NR', 'XR', 'XPN', 'XSN'}

async def uncertain_compounds(text, tokens, lookup, blocked=()):
    proposals = []
    forms = set()
    index = 0
    while index < len(tokens):
        first = tokens[index]
        tag = first.tag.split('-')[0]
        if tag not in TAGS or first.length < 1 or first.start > 0 and '가' <= text[first.start-1] <= '힣':
            index += 1
            continue
        parts = [first]
        end = first.start + first.length
        j = index + 1
        while j < len(tokens) and len(parts) < 8:
            token = tokens[j]
            if token.tag.split('-')[0] not in TAGS or token.start != end or token.length < 1:
                break
            if text[token.start:token.start+token.length] != token.form:
                break
            parts.append(token)
            end = token.start + token.length
            j += 1
        surface = text[first.start:end]
        if (len(parts) >= 2 and 2 <= len(surface) <= 24 and HANGUL.fullmatch(surface)
                and any(p.length == 1 for p in parts)
                and not overlaps_proper_noun(first.start, end, blocked)
                and not any(p.tag.split('-')[0] == 'NNP' for p in parts)):
            proposals.append((first.start, end, surface, tuple(p.form for p in parts)))
            forms.add(surface)
            forms.update(p.form for p in parts)
        index = max(index + 1, j)
    if not proposals:
        return []
    entries = await lookup(sorted(forms))
    risks = []
    for start, end, surface, parts in proposals:
        # Full native/converted headword is positive lexical-boundary evidence.
        if entries.get(surface):
            continue
        if not any(entries.get(part) for part in parts):
            continue
        risks.append((start, end, surface, 'kiwi_split_no_full_headword'))
    return risks

def weak_unique_candidate(segment, tokens):
    """Risk, not proof of an error. Prefer words without contextual evidence.

    A sole dictionary candidate with only generic reliability/POS evidence
    is not semantic verification. Keep this narrow to very short homophones
    to prevent universal full-model review in the default mode.
    """
    surface = segment.original
    if not HANGUL.fullmatch(surface) or len(surface) != 2:
        return False
    if segment.status != 'converted' or len(segment.candidates) != 1:
        return False
    entry = segment.candidates[0]
    if not entry.get('is_reliable') or not entry.get('replacement'):
        return False
    reason = str(entry.get('selection_reason') or '')
    if any(marker in reason for marker in ('collocation_match(', 'quantity_unit_bonus')):
        return False
    if float(entry.get('score') or 0) > 0.56:
        return False
    if any(t.tag.split('-')[0] in {'NNP','VV','VA','VX','VCP'} and t.start < segment.end and t.start+t.length > segment.start for t in tokens):
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
