"""Protocol adapter around the unmodified Arrow36 converter decisions."""
import asyncio
import re
from pathlib import Path
from backend.bootstrap import ensure_environment
from backend.offsets import to_utf16
ensure_environment()
from app.services.converter import ConverterService
from app.services.tokenizer import TokenizerService
from app.services.dictionary import DictionaryService
from app.services.disambiguation import DisambiguationService
from app.database import validate_database

ENGINE_VERSION = '34fd08a7d03706a21a2c2e1b00571f2d838cd508:kra-author-parity-2'
DEFAULT_DB = Path(__file__).resolve().parent / 'hanja_dict.db'
HANJA = re.compile(r'[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]')

def safe_replacement(value):
    return isinstance(value,str) and bool(HANJA.search(value)) and not any(c in value for c in '<>\x00\r\n') and not any(ord(c)<32 for c in value)

class Engine:
    """Async shared engine. Inject tokenizer/lookup_fn for dictionary-free tests."""
    def __init__(self,db_path=DEFAULT_DB,*,tokenizer=None,lookup_fn=None,fingerprint=None):
        self.db_path=Path(db_path)
        self.tokenizer=tokenizer
        self.dictionary=None
        self.lookup_fn=lookup_fn
        self.fingerprint=fingerprint
        self.dictionary_metadata={}
        self.disambiguation=DisambiguationService()
        self._lock=asyncio.Lock()
        self._ready=False
    async def initialize(self):
        async with self._lock:
            if self._ready:return
            if self.lookup_fn is None:
                await asyncio.to_thread(validate_database,self.db_path.resolve())
                self.dictionary=DictionaryService(str(self.db_path.resolve()))
                self.lookup_fn=self.dictionary.batch_lookup_candidates
                self.disambiguation.set_collocations(await self.dictionary.load_collocations())
                import sqlite3
                with sqlite3.connect(self.db_path.resolve().as_uri()+'?mode=ro',uri=True) as db:
                    db.row_factory=sqlite3.Row
                    row=db.execute('SELECT sha256, source_filename, data_version, total_entries, total_senses FROM import_metadata LIMIT 1').fetchone()
                    if not row or not row[0]:raise RuntimeError('Dictionary lacks import fingerprint; import official ZIP first.')
                    self.fingerprint=row[0]
                    self.dictionary_metadata={k:row[k] for k in row.keys() if k!='sha256'}
            if self.tokenizer is None:self.tokenizer=await asyncio.to_thread(TokenizerService)
            if not self.tokenizer.is_available:raise RuntimeError('Kiwi tokenizer unavailable')
            self._ready=True
    async def tokens(self,text):
        await self.initialize()
        return await self.tokenizer.tokenize_async(text)
    async def lookup_entries(self,forms):
        await self.initialize()
        if self.dictionary is None: return {f:[] for f in forms}
        db=await self.dictionary.get_connection()
        try:
            return {f:await self.dictionary.lookup_by_written_form(f,db) for f in dict.fromkeys(forms)}
        finally:
            await db.close()
    async def analyze(self,text,modes):
        if len(text)>20000:raise ValueError('Text exceeds 20,000 characters')
        await self.initialize()
        review_all=bool(modes.get('reviewAll',False))
        # The original converter owns tokenization, lookup forms, scoring,
        # whole-word precedence and certainty. Do not rescan skipped compounds
        # or add lexical lookups: only its actual ambiguous segments need review.
        converter=ConverterService(self.tokenizer,self.disambiguation)
        segments,_=await converter.convert(text,self.lookup_fn)
        upstream_counts={f'upstream_{status}':sum(s.status==status for s in segments) for status in ('converted','ambiguous','no_match','kept')}
        annotations=[]; reviews=[]; occupied=[]; rejected=0
        def valid(start,end,surface):return isinstance(start,int) and isinstance(end,int) and 0<=start<end<=len(text) and text[start:end]==surface
        for s in segments:
            if s.status not in ('converted','ambiguous'):continue
            if not valid(s.start,s.end,s.original):rejected+=1;continue
            if s.status=='converted' and not review_all:
                if not safe_replacement(s.display_text) or any(s.start<b and a<s.end for a,b in occupied):rejected+=1;continue
                occupied.append((s.start,s.end))
                if modes.get('hanja',True):annotations.append(dict(start=to_utf16(text,s.start),end=to_utf16(text,s.end),surface=s.original,type='hanja',replacement=s.display_text))
            else:reviews.append((s.start,s.end,s.original,s.candidates))
        # Only review needs tokens to reproduce the original display builder.
        review_tokens=await self.tokens(text) if reviews else []
        choices=[]
        for start,end,surface,candidates in reviews:
            if not valid(start,end,surface):rejected+=1;continue
            if any(start<b and a<end for a,b in occupied):continue
            for c in candidates:
                replacement=c.get('replacement')
                if (not review_all and not c.get('is_reliable')) or not safe_replacement(replacement):continue
                # Preserve inflected Korean suffixes using unchanged upstream display builder.
                token=next((t for t in review_tokens if t.start==start and t.start+t.length==end),None)
                if token is not None:
                    from app.services.disambiguation import CandidateScore
                    score=CandidateScore(**{k:c.get(k) for k in CandidateScore.__dataclass_fields__ if k in c})
                    replacement=converter._build_display_text(token,score)
                    if token.is_verb_stem and token.form.endswith('하') and len(c['replacement'])<len(surface): replacement=c['replacement']+surface[len(c['replacement']):]
                if safe_replacement(replacement):choices.append((start,end,replacement,c.get('entry_id')))
        components=[]
        for choice in sorted(set(choices)):
            if not components or choice[0]>=max(x[1] for x in components[-1]):components.append([choice])
            else:components[-1].append(choice)
        targets=[]
        if modes.get('hanja',True):
            for number,component in enumerate(components):
                start=min(x[0] for x in component);end=max(x[1] for x in component)
                options=[dict(choice_id='KEEP',type='keep',replacement=text[start:end],entry_id=None,definitions=[])]
                if review_all and self.dictionary is not None:
                    # Native/non-Hanja dictionary readings explain KEEP without a local recommendation.
                    for a,b,_,candidates in reviews:
                        if a>=end or b<=start:continue
                        for candidate in candidates:
                            if safe_replacement(candidate.get('replacement')):continue
                            entry=candidate.get('entry_id')
                            if entry is None:continue
                            detail=await self.dictionary.get_entry_detail(entry)
                            options[0]['definitions'].extend(s['definition'] for s in (detail or {}).get('senses',[]) if s.get('definition'))
                # Each fixed option changes one candidate span and preserves the rest of the connected region.
                for n,(a,b,replacement,entry) in enumerate(component):
                    if self.dictionary is not None:
                        detail=await self.dictionary.get_entry_detail(entry)
                        definitions=[s['definition'] for s in (detail or {}).get('senses',[]) if s.get('definition')]
                    else:
                        definitions=[]
                    options.append(dict(choice_id=f'c{n}',type='hanja',replacement=text[start:a]+replacement+text[b:end],entry_id=entry,definitions=definitions))
                targets.append(dict(target_id=f't{number}',start=to_utf16(text,start),end=to_utf16(text,end),surface=text[start:end],context=text,options=options))
        skipped_mixed=0
        if modes.get('loanword',False):
            from backend.loanwords import collect, merge_targets
            tokens=await self.tokens(text)
            entries=await self.lookup_entries([t.form for t in tokens])
            # Only enabled Hanja annotations occupy ranges; competing origins still
            # participate through all-entry lookup when Hanja display is disabled.
            loan=collect(text,tokens,entries,occupied if modes.get('hanja',True) else [],force_review=review_all)
            skipped_mixed=loan['skipped_mixed']
            # A locally certain loan overlapping an original Hanja review becomes
            # a fixed review option instead of pre-empting that connected region.
            for annotation in loan['annotations']:
                overlapping=any(annotation['start']<t['end'] and t['start']<annotation['end'] for t in targets)
                if overlapping:
                    loan['targets'].append(dict(start=annotation['start'],end=annotation['end'],surface=annotation['surface'],context=text,options=[dict(choice_id='KEEP',type='keep',replacement=annotation['surface'],entry_id=None,definitions=[]),dict(choice_id='c0',type='loanword',replacement=annotation['replacement'],entry_id=annotation['entry_id'],definitions=annotation['definitions'])]))
                else:annotations.append({k:v for k,v in annotation.items() if k not in ('entry_id','definitions')})
            for target in loan['targets']:
                if self.dictionary is not None:
                    for option in target['options'][1:]:
                        detail=await self.dictionary.get_entry_detail(option['entry_id'])
                        option['definitions']=[s['definition'] for s in (detail or {}).get('senses',[]) if s.get('definition')]
            targets=merge_targets(text,targets+loan['targets'])
        return dict(engine_version=ENGINE_VERSION,dictionary_fingerprint=self.fingerprint,annotations=annotations,targets=targets,stats=dict(local_determined=len(annotations),pending=len(targets),structural_rejections=rejected,skipped_mixed=skipped_mixed,**upstream_counts))

_default_engine=None
async def analyze(text: str,modes: dict) -> dict:
    global _default_engine
    if _default_engine is None:_default_engine=Engine()
    return await _default_engine.analyze(text,modes)
