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
