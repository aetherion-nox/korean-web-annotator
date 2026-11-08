"""Exact dictionary sense choices for person-name and ordinary-word homographs."""
from backend.loanwords import CJK,classify_origin
from backend.mixed_origins import align_mixed,is_mixed_origin
from backend.offsets import to_utf16

def _option_for_entry(word,record,modes):
    raw=record.get('origin_raw')
    entry_id=record.get('entry_id',record.get('id'))
    if entry_id is None:return None
    definition=record.get('definition_preview')
    option=dict(entry_id=entry_id,definitions=[definition] if definition else [])
    if isinstance(raw,str) and is_mixed_origin(raw):
        aligned=align_mixed(word,raw)
        if aligned:
            parts=[part for part in aligned if (part['type']=='hanja' and modes.get('hanja',True)) or (part['type']=='loanword' and modes.get('loanword',False))]
            if parts:
                replacement=word
                for part in reversed(parts):replacement=replacement[:part['start']]+part['replacement']+replacement[part['end']:]
                return {**option,'type':parts[0]['type'] if len(parts)==1 else 'mixed',
                        'replacement':replacement,'segments':[{**part,'start':to_utf16(word,part['start']),
                        'end':to_utf16(word,part['end'])} for part in parts]}
    elif isinstance(raw,str) and modes.get('hanja',True) and CJK.search(raw):
        if len(raw)==len(word) and all(CJK.fullmatch(c) for c in raw):
            return {**option,'type':'hanja','replacement':raw}
    elif isinstance(raw,str) and modes.get('loanword',False) and classify_origin(raw)=='loanword':
        return {**option,'type':'loanword','replacement':raw}
    return {**option,'type':'nonconversion','replacement':word}

def homograph_target(text,start,end,word,records,modes):
    options=[dict(choice_id='KEEP',type='keep',replacement=word,entry_id=None,definitions=[])]
    next_native=next_conversion=0
    for record in records:
        option=_option_for_entry(word,record,modes)
        if option is None:continue
        if option['type']=='nonconversion':
            option['choice_id']=f'n{next_native}';next_native+=1
        else:
            option['choice_id']=f'c{next_conversion}';next_conversion+=1
        options.append(option)
    return dict(start=to_utf16(text,start),end=to_utf16(text,end),surface=word,
                context=text,options=options,dictionary_person_name=True,dictionary_name_homograph=True)

def surname_ambiguity_target(text,start,end,word,records,modes):
    target=homograph_target(text,start,end,word,records,modes)
    target.pop('dictionary_person_name',None)
    target.pop('dictionary_name_homograph',None)
    target['suspected_person_name']=True
    return target
