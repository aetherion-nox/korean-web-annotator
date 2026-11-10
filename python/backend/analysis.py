"""Protocol adapter around Arrow36 conversion with native-reading safeguards."""
import asyncio
import re
from pathlib import Path
from backend.bootstrap import ensure_environment
from backend.offsets import to_utf16
from backend.proper_nouns import proper_noun_ranges, overlaps_proper_noun, surname_name_evidence, dictionary_name_evidence, is_dictionary_person
from backend.name_homographs import homograph_target, surname_ambiguity_target
from backend.loanwords import is_nonconversion_origin, nonconversion_options
ensure_environment()
from app.services.converter import ConverterService
from app.services.tokenizer import TokenizerService
from app.services.dictionary import DictionaryService
from app.services.disambiguation import DisambiguationService
from app.database import validate_database

ENGINE_VERSION = '34fd08a7d03706a21a2c2e1b00571f2d838cd508:kra-name-homograph-1.1.55'
DEFAULT_DB = Path(__file__).resolve().parent / 'hanja_dict.db'
HANJA = re.compile(r'[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]')

def safe_replacement(value):
    return isinstance(value,str) and bool(HANJA.search(value)) and not any(c in value for c in '<>\x00\r\n') and not any(ord(c)<32 for c in value)

def restore_mixed_display(surface, replacement, origin, *, token=None, written_form=None):
    """Recover omitted native anchors only from an explicit full dictionary origin.

    A short Hanja-only origin never proves which source syllables to keep.
    Do not synthesize missing letters or alter the original converter's ranking.
    """
    if not isinstance(origin, str) or not isinstance(replacement, str):
        return replacement
    # Strip a dictionary ending only with the tokenizer's verb lemma AND the
    # selected entry's exact headword as evidence. Never infer a native suffix
    # from the length difference of a Hanja-only origin.
    if (token is not None and token.is_verb_stem
            and written_form == token.form + '다'
            and len(origin) == len(written_form) and origin.endswith('다')):
        stem_origin = origin[:-1]
        if (len(surface) == len(token.form) == len(stem_origin)
                and any('가' <= c <= '힣' for c in stem_origin)
                and ''.join(c for c in stem_origin if HANJA.fullmatch(c)) == replacement
                and all(('가' <= source <= '힣') and
                        (HANJA.fullmatch(target) or target == source)
                        for source, target in zip(token.form, stem_origin))
                and all(not HANJA.fullmatch(target) or source == lemma
                        for source, lemma, target in zip(surface, token.form, stem_origin))):
            return ''.join(target if HANJA.fullmatch(target) else source
                           for source, target in zip(surface, stem_origin))
    if len(origin) != len(surface):
        return replacement
    if not replacement or not all(HANJA.fullmatch(c) for c in replacement):
        return replacement
    if not any('가' <= c <= '힣' for c in origin):
        return replacement
    if ''.join(c for c in origin if HANJA.fullmatch(c)) != replacement:
        return replacement
    for source, target in zip(surface, origin):
        if not ('가' <= source <= '힣'):
            return replacement
        if not HANJA.fullmatch(target) and target != source:
            return replacement
    return origin

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
    async def lookup_entries(self,forms,*,filter_people=False):
        await self.initialize()
        if self.dictionary is None: return {f:[] for f in forms}
        db=await self.dictionary.get_connection()
        try:
            entries=await self.dictionary.batch_lookup_entries(forms,db)
            return {f:[r for r in records if not is_dictionary_person(r)] for f,records in entries.items()} if filter_people else entries
        finally:
            await db.close()
    async def analyze(self,text,modes):
        if len(text)>20000:raise ValueError('Text exceeds 20,000 characters')
        await self.initialize()
        review_all=bool(modes.get('reviewAll',False))
        # Selective audit: review positive local conversions, but do NOT resurrect
        # locally rejected/nonconversion senses or turn unchanged words into targets.
        review_conversions=review_all or bool(modes.get('reviewLocalConversions',False))
        filter_dictionary_people=modes.get('filterDictionaryPeople',False) is True
        # Filter a working view, never mutate the imported dictionary or its
        # globally cached candidate lists. Raw lookups still power name protection.
        async def conversion_lookup(forms):
            result=await self.lookup_fn(forms)
            if not filter_dictionary_people:return result
            return {form:[record for record in records if not is_dictionary_person(record)]
                    for form,records in result.items()}
        # The original converter owns tokenization, lookup forms, scoring,
        # whole-word precedence and certainty. Do not rescan skipped compounds
        # for general conversion. Exact mixed/cross-origin words have a
        # complete whole-entry choice path below, before source projection.
        converter=ConverterService(self.tokenizer,self.disambiguation)
        tokens=await self.tokens(text)
        segments,_=await converter.convert(text,conversion_lookup,tokens=tokens)
        dictionary_names,homograph_evidence=await dictionary_name_evidence(text,tokens,self.lookup_fn)
        proper_ranges=proper_noun_ranges(tokens)+dictionary_names
        name_protection=modes.get('nameProtection',True) is not False
        homograph_evidence=homograph_evidence if name_protection else []
        conflicting_ranges=[(a,b) for a,b,_,_ in homograph_evidence]
        protected_dictionary_names=[(a,b) for a,b in dictionary_names if (a,b) not in conflicting_ranges]
        inferred_names,surname_ambiguities=await surname_name_evidence(text,tokens,self.lookup_fn) if name_protection else ([],[])
        protected_names=sorted(set(inferred_names+protected_dictionary_names)) if name_protection else []
        homograph_evidence=[item for item in homograph_evidence if not any(a<=item[0] and item[1]<=b for a,b in protected_names)]
        surname_ambiguities=[item for item in surname_ambiguities if not any(a<item[1] and item[0]<b for a,b in protected_names+dictionary_names)]
        surname_ambiguities=[item for item in surname_ambiguities if not any(a<item[1] and item[0]<b for a,b,_,_ in homograph_evidence)]
        conflicting_ranges=[(a,b) for a,b,_,_ in homograph_evidence]
        suspect_ranges=[(a,b) for a,b,_,_ in surname_ambiguities]
        homograph_targets=[homograph_target(text,a,b,word,[r for r in records if not filter_dictionary_people or not is_dictionary_person(r)],modes) for a,b,word,records in homograph_evidence]
        suspect_targets=[surname_ambiguity_target(text,a,b,word,[r for r in records if not filter_dictionary_people or not is_dictionary_person(r)],modes) for a,b,word,records in surname_ambiguities]
        blocked_for_local=protected_names+conflicting_ranges+suspect_ranges
        upstream_counts={f'upstream_{status}':sum(s.status==status for s in segments) for status in ('converted','ambiguous','no_match','kept')}
        mixed=dict(annotations=[],targets=[],ranges=[],skipped_mixed=0)
        if self.dictionary is not None and (modes.get('hanja',True) or modes.get('loanword',False)):
            from backend.mixed_origins import collect_mixed
            whole_word_ranges=[(s.start,s.end) for s in segments if s.selection_reason in ('whole_word_match','whole_word_keep_competition')]
            mixed=await collect_mixed(self,text,tokens,{**modes,'reviewAll':review_conversions},whole_word_ranges=whole_word_ranges,blocked_ranges=blocked_for_local,review_ranges=dictionary_names)
        annotations=list(mixed['annotations']); reviews=[]; occupied=list(mixed['ranges']); rejected=0
        def valid(start,end,surface):return isinstance(start,int) and isinstance(end,int) and 0<=start<end<=len(text) and text[start:end]==surface
        for s in segments:
            if overlaps_proper_noun(s.start,s.end,blocked_for_local):continue
            if s.status not in ('converted','ambiguous'):continue
            if any(s.start<b and a<s.end for a,b in mixed['ranges']):continue
            if not valid(s.start,s.end,s.original):rejected+=1;continue
            if s.status=='converted' and not review_conversions and not overlaps_proper_noun(s.start,s.end,proper_ranges):
                if not safe_replacement(s.display_text) or any(s.start<b and a<s.end for a,b in occupied):rejected+=1;continue
                occupied.append((s.start,s.end))
                token=next((t for t in tokens if t.start==s.start and t.start+t.length==s.end),None)
                selected=next((c for c in s.candidates if c.get('entry_id')==s.matched_entry_id),{})
                if modes.get('hanja',True):annotations.append(dict(start=to_utf16(text,s.start),end=to_utf16(text,s.end),surface=s.original,type='hanja',replacement=restore_mixed_display(s.original,s.display_text,s.origin_raw,token=token,written_form=selected.get('written_form'))))
            else:reviews.append((s.start,s.end,s.original,s.candidates))
        # Only review needs tokens to reproduce the original display builder.
        review_tokens=tokens if reviews else []
        definitions_by_entry=await self.dictionary.get_definitions_for_entries([c.get('entry_id') for _,_,_,candidates in reviews for c in candidates]) if self.dictionary is not None else {}
        choices=[]
        for start,end,surface,candidates in reviews:
            if not valid(start,end,surface):rejected+=1;continue
            if any(start<b and a<end for a,b in occupied):continue
            for c in candidates:
                replacement=c.get('replacement')
                if (not review_conversions and not overlaps_proper_noun(start,end,proper_ranges) and not c.get('is_reliable')) or not safe_replacement(replacement):continue
                # Preserve inflected Korean suffixes using unchanged upstream display builder.
                token=next((t for t in review_tokens if t.start==start and t.start+t.length==end),None)
                if token is not None:
                    from app.services.disambiguation import CandidateScore
                    score=CandidateScore(**{k:c.get(k) for k in CandidateScore.__dataclass_fields__ if k in c})
                    replacement=converter._build_display_text(token,score)
                    if token.is_verb_stem and token.form.endswith('하') and len(c['replacement'])<len(surface): replacement=c['replacement']+surface[len(c['replacement']):]
                replacement=restore_mixed_display(surface,replacement,c.get('origin_raw'),token=token,written_form=c.get('written_form'))
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
                if self.dictionary is not None:
                    # Dictionary readings that preserve Korean are explicit sense options.
                    for a,b,_,candidates in reviews:
                        # A sense of a subspan cannot explain the whole merged
                        # occurrence. In particular 이 is not a sense of 중이.
                        if a!=start or b!=end:continue
                        for candidate in candidates:
                            if safe_replacement(candidate.get('replacement')) or not is_nonconversion_origin(candidate.get('origin_raw'),loanword=modes.get('loanword',False)):continue
                            if not review_all and 'pos_mismatch' in (candidate.get('selection_reason') or ''):continue
                            entry=candidate.get('entry_id')
                            if entry is None:continue
                            options.extend(nonconversion_options(text[start:end],[candidate],definitions_by_entry=definitions_by_entry,loanword=modes.get('loanword',False)))
                # Each fixed option changes one candidate span and preserves the rest of the connected region.
                for n,(a,b,replacement,entry) in enumerate(component):
                    if self.dictionary is not None:
                        definitions=definitions_by_entry.get(entry,[])
                    else:
                        definitions=[]
                    options.append(dict(choice_id=f'c{n}',type='hanja',replacement=text[start:a]+replacement+text[b:end],entry_id=entry,definitions=definitions))
                targets.append(dict(target_id=f't{number}',start=to_utf16(text,start),end=to_utf16(text,end),surface=text[start:end],context=text,options=options))
        skipped_mixed=0
        if modes.get('loanword',False):
            from backend.loanwords import collect, merge_targets
            entries=await self.lookup_entries([t.form for t in tokens],filter_people=filter_dictionary_people)
            # Whole-entry owned words already contain all sibling origins in every mode.
            # Disabled Hanja annotations must not block ordinary loanword lookup.
            loan=collect(text,tokens,entries,(occupied if modes.get('hanja',True) else mixed['ranges'])+blocked_for_local,force_review=review_conversions,hanja_enabled=modes.get('hanja',True),review_ranges=dictionary_names)
            skipped_mixed=loan['skipped_mixed']
            # A locally certain loan overlapping an original Hanja review becomes
            # a fixed review option instead of pre-empting that connected region.
            for annotation in loan['annotations']:
                overlapping=any(annotation['start']<t['end'] and t['start']<annotation['end'] for t in targets)
                if overlapping:
                    loan['targets'].append(dict(start=annotation['start'],end=annotation['end'],surface=annotation['surface'],context=text,options=[dict(choice_id='KEEP',type='keep',replacement=annotation['surface'],entry_id=None,definitions=[]),dict(choice_id='c0',type='loanword',replacement=annotation['replacement'],entry_id=annotation['entry_id'],definitions=annotation['definitions'])]))
                else:annotations.append({k:v for k,v in annotation.items() if k not in ('entry_id','definitions')})
            targets=merge_targets(text,targets+loan['targets'])
        targets=sorted(targets+mixed['targets']+homograph_targets+suspect_targets,key=lambda t:(t['start'],t['end']))
        # Complete every candidate, including sibling origins owned by mixed words.
        option_definitions=await self.dictionary.get_definitions_for_entries([o['entry_id'] for t in targets for o in t['options'] if o['type']!='keep']) if self.dictionary is not None else {}
        option_metadata=await self.dictionary.get_metadata_for_entries(option_definitions) if self.dictionary is not None else {}
        filtered_person_only=set()
        for target in targets:
            native=[];conversions=[];seen=set()
            removed_person_sense=False
            for option in target['options']:
                if option['type']=='keep':continue
                option={**option,**option_metadata.get(option['entry_id'],{})}
                definitions=option_definitions.get(option['entry_id'],option['definitions'])
                if filter_dictionary_people and is_dictionary_person({**option,'definitions':definitions}):
                    removed_person_sense=True
                    continue
                if option['type']=='nonconversion':
                    for definition in definitions:
                        key=(option['entry_id'],definition)
                        if not definition or key in seen:continue
                        seen.add(key)
                        native.append({**option,'choice_id':f'n{len(native)}','definitions':[definition]})
                else:conversions.append({**option,'choice_id':f'c{len(conversions)}','definitions':definitions})
            target['options']=[dict(choice_id='KEEP',type='keep',replacement=target['surface'],entry_id=None,definitions=[])]+native+conversions
            if removed_person_sense and not native and not conversions:
                filtered_person_only.add(id(target))
        # Do not send person-only remnants (KEEP with no lexical sense) to the
        # model, which could otherwise invent an experimental origin for a name.
        if filtered_person_only:
            targets=[target for target in targets if id(target) not in filtered_person_only]
        # Encode each token boundary once, not once per review target.
        # This retains the existing surrogate/astral offset conversion exactly.
        token_morphology=[dict(form=t.form,tag=t.tag,start=to_utf16(text,t.start),end=to_utf16(text,t.start+t.length)) for t in tokens]
        nominal_bounds=[m for t,m in zip(tokens,token_morphology) if t.length>0 and t.tag.split('-')[0] in {'NNG','NNP','NNB','NR','XR','XPN','XSN','MM'}]
        nominal_starts={m['start'] for m in nominal_bounds};nominal_ends={m['end'] for m in nominal_bounds}
        proper_utf16=[(to_utf16(text,a),to_utf16(text,b)) for a,b in proper_ranges]
        dictionary_name_utf16=[(to_utf16(text,a),to_utf16(text,b)) for a,b in dictionary_names]
        for i,target in enumerate(targets):
            target['target_id']=f't{i}'
            a=target['start'];b=target['end']
            target['morphology']=[dict(m) for m in token_morphology if m['start']<b and a<m['end']]
            target['partial_word']=a in nominal_ends or b in nominal_starts
            if overlaps_proper_noun(target['start'],target['end'],proper_utf16):target['proper_noun']=True
            if overlaps_proper_noun(target['start'],target['end'],dictionary_name_utf16):target['dictionary_person_name']=True
        # Expose Kiwi's actual proposal and conservative name/proper-noun
        # boundaries only for optional single-pass LLM segmentation auditing.
        # All offsets are converted once to JavaScript UTF-16 coordinates.
        # No second tokenization/lookup run, no new dictionary dependencies.
        repair_context={}
        if modes.get('smartSegmentation',False):
            guarded=proper_ranges+(protected_names if name_protection else [])+suspect_ranges+conflicting_ranges
            protected=sorted(set((to_utf16(text,a),to_utf16(text,b)) for a,b in guarded if 0<=a<b<=len(text)))
            repair_context={'repair_context':{
                'kiwi_tokens':token_morphology,
                'protected_ranges':[list(item) for item in protected]}}
        return dict(engine_version=ENGINE_VERSION,dictionary_fingerprint=self.fingerprint,annotations=annotations,targets=targets,**repair_context,stats=dict(local_determined=len(annotations),pending=len(targets),protected_names=len(protected_names),structural_rejections=rejected,skipped_mixed=skipped_mixed+mixed['skipped_mixed'],**upstream_counts))

_default_engine=None
async def analyze(text: str,modes: dict) -> dict:
    global _default_engine
    if _default_engine is None:_default_engine=Engine()
    return await _default_engine.analyze(text,modes)
