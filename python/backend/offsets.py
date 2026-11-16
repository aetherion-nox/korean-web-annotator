"""Original Python indices to JavaScript UTF-16 code units.

Build a bounded, per-source index of supplementary Unicode code points once.
Korean legal pages can have thousands of token positions per source: encoding
text[:index] at every position made long-document analysis quadratic.
"""
from bisect import bisect_left
from functools import lru_cache

@lru_cache(maxsize=32)
def _supplementary_positions(text: str) -> tuple[int, ...]:
    # Python's utf-16-le/surrogatepass maps each >U+FFFF code point to two
    # code units. Existing (unpaired) surrogate code points still use one.
    return tuple(i for i, c in enumerate(text) if ord(c) > 0xFFFF)

def to_utf16(text: str, index: int) -> int:
    if not 0 <= index <= len(text):
        raise ValueError('Offset outside original text')
    return index + bisect_left(_supplementary_positions(text), index)
