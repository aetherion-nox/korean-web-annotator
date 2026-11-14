"""Source-faithful microprofiles of v1.1.56.31's worst-case hot spots.

No Kiwi results or user dictionary are claimed: crafted tokens isolate exact
Python functions. Mutating the quantity helper is only temporary during the
benchmark; this script does not edit product source.
"""
import asyncio
import json
import re
import sys
import time
from pathlib import Path
from unittest.mock import patch

ROOT=Path(__file__).resolve().parents[1]
sys.path[:0]=[str(ROOT/'python'),str(ROOT/'python/backend/upstream')]
from app.services.tokenizer import MorphToken,TokenizerService
from app.services.converter import ConverterService
from app.services.disambiguation import DisambiguationService
from app.services.quantity import has_quantity_before, indexed_quantity_before
from browser_bridge import compact_analysis_wire
from backend.loanwords import collect

def fmt(n,seconds):
    return f'{seconds*1000:.2f}ms'

def make_case(n):
    text='가나 '*n
    tokens=[MorphToken(form='가나',tag='NNG',start=3*i,length=2,
        original='가나',is_hangul=True,is_noun=True,is_verb_stem=False,
        is_suffix=False,is_particle=False,is_punct=False) for i in range(n)]
    return text,tokens

def timed(func):
    start=time.perf_counter()
    out=func()
    return time.perf_counter()-start,out

async def run():
    print('BENCH_START',flush=True)
    print('SEQUENCE','number of Korean lexical tokens; 3 chars per token')
    for n in (500,1000,2000,3500,5500):
        text,tokens=make_case(n)
        elapsed,_=timed(lambda: [has_quantity_before(text,tokens,t.start) for t in tokens])
        indexed,_=timed(lambda: indexed_quantity_before(text,tokens))
        print('QUANTITY',n,'legacy_ms',round(elapsed*1000,2),'indexed_ms',
              round(indexed*1000,2),'speedup',round(elapsed/indexed,2),flush=True)

    tokenizer=TokenizerService.__new__(TokenizerService)
    tokenizer._available=True
    converter=ConverterService(tokenizer,DisambiguationService())
    candidate=dict(entry_id=1,written_form='가나',origin_raw='假那',
        replacement='假那',replacement_type='pure_hanja',is_reliable=True,
        part_of_speech='명사',homonym_number=1)
    async def lookup(forms):
        return {form:([dict(candidate)] if form=='가나' else []) for form in forms}
    import app.services.converter as converter_module
    original=converter_module.has_quantity_before
    for n in (400,800,1600,3200):
        text,tokens=make_case(n)
        baselineStart=time.perf_counter()
        result=await converter.convert(text,lookup,tokens=tokens)
        t0=time.perf_counter()-baselineStart
        converter_module.has_quantity_before=lambda text,tokens,start:False
        try:
            optimizedStart=time.perf_counter()
            patched=await converter.convert(text,lookup,tokens=tokens)
            t1=time.perf_counter()-optimizedStart
        finally:
            converter_module.has_quantity_before=original
        print('CONVERTER',n,'baseline_ms',round(t0*1000,2),
              'quantity_no_scan_ms',round(t1*1000,2),'speedup',round(t0/t1,2),
              'same_segments',len(result[0])==len(patched[0]),flush=True)
    entry=dict(id=1,origin_raw='Gana',part_of_speech='명사',definition_preview='proper loan spelling')
    for n in (400,800,1600,3200):
        text,tokens=make_case(n)
        secs,res=timed(lambda:collect(text,tokens,{'가나':[entry]},[],hanja_enabled=True))
        print('LOANWORDS',n,'elapsed_ms',round(secs*1000,2),
              'annotation_count',len(res['annotations']),
              'target_count',len(res['targets']),flush=True)
    for n in (500,1000,2000,4000):
        text,tokens=make_case(n)
        targets=[dict(target_id='t'+str(i),start=3*i,end=3*i+2,
             surface='가나',context=text,options=[{'choice_id':'KEEP','type':'keep',
             'replacement':'가나','entry_id':None,'definitions':[]}]) for i in range(n//2)]
        secs,payload=timed(lambda:json.dumps(compact_analysis_wire(
            dict(targets=targets,annotations=[],stats={})),ensure_ascii=False))
        print('SERIALIZE',n,'chars',len(text),'targets',len(targets),
              'chars_out',len(payload),'utf8_bytes',len(payload.encode()),
              'elapsed_ms',round(secs*1000,2),flush=True)
    print('BENCH_DONE',flush=True)
if __name__=='__main__':asyncio.run(run())
