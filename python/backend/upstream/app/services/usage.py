"""Optional dictionary evidence and observed numeric adjacency, never guessed senses."""
import re

_UNIT = re.compile(r'(?:세는|재는|나타내는)\s*단위(?:[.。]|$|이다|를|로|의|인|\s)')
_SURNAME = re.compile(r'(?:성\s*[(（]\s*姓\s*[)）]|성씨)\s*의\s*하나')

def sense_evidence(definition):
    text=definition if isinstance(definition,str) else ''
    return dict(unit_usage=bool(_UNIT.search(text)),surname_usage=bool(_SURNAME.search(text)))

def quantity_context(text,tokens,start,end):
    """An immediately preceding SN/NR is an observation, not proof of a unit."""
    left=[t for t in tokens if t.length>0 and t.start+t.length<=start]
    if not left:return None
    token=max(left,key=lambda t:t.start+t.length)
    tag=token.tag.split('-')[0]
    if tag not in {'SN','NR'}:return None
    number_end=token.start+token.length
    if text[number_end:start].strip() or text[token.start:number_end]!=token.form:return None
    if not re.fullmatch(r'[가-힣]+',text[start:end]):return None
    return dict(number=text[token.start:number_end],number_tag=tag,start=token.start,end=number_end)
