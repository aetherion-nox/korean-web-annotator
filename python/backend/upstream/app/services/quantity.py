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
