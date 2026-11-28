"""Indexed spelling aliases for Korean dictionary headwords.

The dictionary's '-' marks internal word structure, '^' marks a spacing
boundary, and some headwords contain literal spaces. These are lookup
separators, not letters to insert into the page or into Hanja alignments.
Only exact indexed spelling variants are queried; no LIKE/REPLACE table scans.
"""
import re
import unicodedata
from itertools import product

HANGUL = re.compile(r'^[가-힣]+$')
SEPARATORS = ' -^'
MAX_LETTERS = 16
MAX_ALIASES = 96

def is_dictionary_separator(char):
    return char=='^' or unicodedata.category(char).startswith('P') or unicodedata.category(char)=='Zs'

def edge_headword(value):
    """Strip exactly one permitted marker from either edge of a Hangul title.

    Preserve the stored title and POS. Do not remove internal letters, digits,
    control characters or repeated markers. A single syllable is also valid.
    """
    if not isinstance(value,str) or len(value)<2:return ''
    start=int(is_dictionary_separator(value[0]))
    end=int(is_dictionary_separator(value[-1]))
    if not (start or end):return ''
    core=value[start:len(value)-end]
    if not re.fullmatch(r'[가-힣]+(?:[^가-힣][가-힣]+){0,3}',core):return ''
    if any(not is_dictionary_separator(c) for c in core if not '가'<=c<='힣'):return ''
    clean=''.join(c for c in core if '가'<=c<='힣')
    return clean if 1<=len(clean)<=MAX_LETTERS else ''

def canonical_headword(value):
    if not isinstance(value,str):
        return ''
    clean = ''.join(c for c in value if c not in SEPARATORS)
    return clean if 2 <= len(clean) <= MAX_LETTERS and HANGUL.fullmatch(clean) else ''

def headword_aliases(value):
    """Return original exact key plus bounded indexed variants.

    Never strip spaces from the source sentence itself. The output is used
    ONLY for SQL equality/IN probes against existing indexed titles.
    """
    if not isinstance(value,str):
        return ()
    result=[value]
    clean=canonical_headword(value)
    if not clean:
        return tuple(result)
    def add(candidate):
        if candidate not in seen and len(result)<MAX_ALIASES:
            seen.add(candidate);result.append(candidate)
    seen={value}
    add(clean)
    # Existing source spaces/hyphens/carets reveal reliable boundaries.
    # Try their alternative spelling conventions FIRST, including phrases
    # with three or four spaces, before less-constrained insertions.
    chunks=re.split(r'[\\-^ ]',value)
    if 2<=len(chunks)<=5 and all(chunks) and ''.join(chunks)==clean:
        for separators in product(('^','-',' '),repeat=len(chunks)-1):
            alternate=''.join(word+(separators[i] if i<len(separators) else '')
                              for i,word in enumerate(chunks))
            add(alternate)
    # One separator in any position covers 안중근/안-중근 and
    # 이산화 탄소/이산화^탄소, even when the query itself has no separator.
    for boundary in range(1,len(clean)):
        for separator in ('^','-',' '):
            add(clean[:boundary]+separator+clean[boundary:])
    # Multi-separator matches are limited to observed boundaries above.
    # Do not enumerate arbitrary two-/three-gap partitions for every token:
    # that would turn ordinary local lookup into hundreds of SQL probes.
    return tuple(result)

def aligned_hanja_alias(query,record):
    """Repair only source-length reliability for known, pure Hanja origins.

    Original import data stays intact. An original title such as 이산화^탄소
    has a longer literal length than 二酸化炭素, despite exact Hangul alignment.
    """
    origin=record.get('origin_raw')
    original=record.get('written_form')
    source=edge_headword(query) or canonical_headword(query) or (query if isinstance(query,str) and HANGUL.fullmatch(query) and len(query)==1 else '')
    title=edge_headword(original) or canonical_headword(original)
    if not source or source!=title:
        return record
    if not isinstance(origin,str) or len(origin)!=len(source):
        return record
    if not all('\u3400'<=ch<='\u9fff' for ch in origin):
        return record
    if record.get('replacement')==origin and record.get('is_reliable'):
        return record
    return {**record,'replacement':origin,'replacement_type':'pure_hanja','is_reliable':1}
