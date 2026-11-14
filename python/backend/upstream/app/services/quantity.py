"""Dictionary-backed quantity evidence; no word-specific unit list."""
import re
UNIT_DEFINITION = re.compile(r'(?:세는|재는|나타내는)\s*단위(?:[.。]|$|이다|를|로|의|인|\s)')

def is_dependent_noun(dict_pos):
    """Recognize explicit dependent-noun POS labels, never infer from a gloss."""
    compact = re.sub(r'\s+', '', dict_pos or '')
    return compact in {'의존명사', '불완전명사', '依存名詞', '依存名词', '不完全名詞', '不完全名词'}


def has_quantity_before(text, tokens, start):
    left = [t for t in tokens if t.length > 0 and t.start + t.length <= start]
    if not left:
        return False
    previous = max(left, key=lambda t: t.start + t.length)
    return (previous.tag.split('-')[0] in {'SN', 'NR'}
            and not text[previous.start + previous.length:start].strip()
            and text[previous.start:previous.start + previous.length] == previous.form)


def indexed_quantity_before(text, tokens):
    """Precompute exact has_quantity_before() results for every token start.

    Sorting by (end, -original index) preserves the legacy 'first token'
    tie-break when several morphological tokens share an end position.
    Unlike has_quantity_before, this does not rescan the token prefix for
    each occurrence. Build: O(T log T); lookup: O(1).
    """
    from bisect import bisect_right
    ended=sorted(((t.start+t.length,-i,t) for i,t in enumerate(tokens)
                  if t.length>0),key=lambda row:(row[0],row[1]))
    positions=[row[0] for row in ended]
    answers={}
    for token in tokens:
        start=token.start
        if start in answers:continue
        before=bisect_right(positions,start)-1
        if before<0:
            answers[start]=False
            continue
        previous=ended[before][2]
        answers[start]=(previous.tag.split('-')[0] in {'SN','NR'}
                        and not text[previous.start+previous.length:start].strip()
                        and text[previous.start:previous.start+previous.length]==previous.form)
    return answers
