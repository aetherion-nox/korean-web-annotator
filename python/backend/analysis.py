"""Protocol adapter around Arrow36 conversion with native-reading safeguards."""
import asyncio
import re
from time import perf_counter
from bisect import bisect_left, bisect_right
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

ENGINE_VERSION = '34fd08a7d03706a21a2c2e1b00571f2d838cd508:kra-dictionary-name-boundaries-v1:spaced-phrase-v1'
DEFAULT_DB = Path(__file__).resolve().parent / 'hanja_dict.db'

class _SpanIndex:
    """Static overlapping intervals: one O(n log n) build, O(log n) probes."""
    def __init__(self,ranges):
        ordered=sorted(ranges)
        self.starts=[a for a,_ in ordered]
        self.maximum_ends=[]
        maximum=-1
        for _,end in ordered:
            maximum=max(maximum,end)
            self.maximum_ends.append(maximum)

    def overlaps(self,start,end):
        index=bisect_left(self.starts,end)-1
        return index>=0 and self.maximum_ends[index]>start

    def add(self,start,end):
        """Add one late audit target without rebuilding every range list."""
        index=bisect_left(self.starts,start)
        maximum=max(end,self.maximum_ends[index-1] if index else -1)
        self.starts.insert(index,start)
        self.maximum_ends.insert(index,maximum)
        for i in range(index+1,len(self.maximum_ends)):
            if self.maximum_ends[i]>=maximum:break
            self.maximum_ends[i]=maximum


class _OccupiedIndex:
    """Mutable, non-overlapping accepted conversion ranges.

    Mixed-origin ranges and accepted upstream segments must not overlap; use
    two immediate neighbors for exact overlap checks without scanning every
    preceding segment. Keep the source-range list in original insertion order
    for downstream loanword collection.
    """
    def __init__(self,ranges):
        ordered=sorted(ranges)
        self.ordered=list(ordered)
        self.starts=[a for a,_ in ordered]

    def overlaps(self,start,end):
        index=bisect_left(self.starts,start)
        return ((index>0 and self.ordered[index-1][1]>start) or
                (index<len(self.ordered) and self.ordered[index][0]<end))

    def add(self,start,end):
        index=bisect_left(self.starts,start)
        self.starts.insert(index,start)
        self.ordered.insert(index,(start,end))


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
        # A single legal page can repeat the same dictionary headwords hundreds
        # of times across independent <dd>/<li> clauses. Cache immutable
        # dictionary results per Engine instance (reset when the DB reloads).
        self._candidate_cache={}
        self._entry_cache={}
        self._definition_cache={}
        self._metadata_cache={}
        self._query_profile_ms=0.0

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
    @staticmethod
    def _put_cached(cache,requested,data,max_items=8192):
        if len(cache)+len(requested)>max_items:cache.clear()
        for key in requested:
            cache[key]=data.get(key,None)

    async def lookup_candidates_cached(self,forms):
        await self.initialize()
        if self.dictionary is None:return await self.lookup_fn(forms)
        forms=list(dict.fromkeys(forms))
        missing=[form for form in forms if form not in self._candidate_cache]
        if missing:
            query_started=perf_counter()
            result=await self.lookup_fn(missing)
            self._query_profile_ms+=(perf_counter()-query_started)*1000
            self._put_cached(self._candidate_cache,missing,result)
        # Return fresh dictionaries: converter/scoring code must never be able
        # to modify cached raw records used by a different paragraph.
        return {form:[dict(row) for row in (self._candidate_cache.get(form) or [])]
                for form in forms}

    async def lookup_entries(self,forms,*,filter_people=False):
        await self.initialize()
        if self.dictionary is None:return {f:[] for f in forms}
        forms=list(dict.fromkeys(forms))
        missing=[f for f in forms if f not in self._entry_cache]
        if missing:
            query_started=perf_counter()
            db=await self.dictionary.get_connection()
            try:records=await self.dictionary.batch_lookup_entries(missing,db)
            finally:
                if hasattr(self.dictionary,'release_connection'):
                    await self.dictionary.release_connection(db)
                else:await db.close()
            self._query_profile_ms+=(perf_counter()-query_started)*1000
            self._put_cached(self._entry_cache,missing,records)
        entries={f:[dict(row) for row in (self._entry_cache.get(f) or [])]
                 for f in forms}
        return {f:[r for r in records if not is_dictionary_person(r)]
                for f,records in entries.items()} if filter_people else entries

    async def cached_definitions(self,entry_ids):
        if self.dictionary is None:return {}
        keys=list(dict.fromkeys(i for i in entry_ids if i is not None))
        missing=[i for i in keys if i not in self._definition_cache]
        if missing:
            query_started=perf_counter()
            rows=await self.dictionary.get_definitions_for_entries(missing)
            self._query_profile_ms+=(perf_counter()-query_started)*1000
            self._put_cached(self._definition_cache,missing,rows)
        return {key:list(self._definition_cache[key])
                for key in keys if self._definition_cache.get(key) is not None}

    async def cached_metadata(self,entry_ids):
        if self.dictionary is None:return {}
        keys=list(dict.fromkeys(i for i in entry_ids if i is not None))
        missing=[i for i in keys if i not in self._metadata_cache]
        if missing:
            query_started=perf_counter()
            rows=await self.dictionary.get_metadata_for_entries(missing)
            self._query_profile_ms+=(perf_counter()-query_started)*1000
            self._put_cached(self._metadata_cache,missing,rows)
        return {key:dict(self._metadata_cache[key])
                for key in keys if self._metadata_cache.get(key) is not None}
    async def analyze(self,text,modes,progress=None):
        if len(text)>20000:raise ValueError('Text exceeds 20,000 characters')
        analyzed_at=perf_counter()
        # Checkpoints only run for long texts at existing batch/loop
        # boundaries. No per-token messages, extra lookups, or fake heartbeats.
        long_progress=progress is not None and len(text)>=1000
        phase_starts={}
        checkpoint_part=None
        checkpoint_sent_at=analyzed_at
        checkpoint_part_started_at=analyzed_at
        def phase(name,event,**extra):
            if not long_progress:return
            now=perf_counter()
            if event=='start':phase_starts[name]=now
            elif event=='done':
                extra['elapsedMs']=round((now-phase_starts.get(name,now))*1000,1)
            progress({'stage':'analysis-phase','phase':name,'event':event,**extra})
        def checkpoint(name,part,processed,total):
            nonlocal checkpoint_part,checkpoint_sent_at,checkpoint_part_started_at
            if not long_progress or total<=0:return
            now=perf_counter()
            key=(name,part)
            switched=key!=checkpoint_part
            if switched:
                checkpoint_part=key
                checkpoint_part_started_at=now
            elif now-checkpoint_sent_at<0.35:return
            checkpoint_sent_at=now
            progress({'stage':'analysis-phase','phase':name,'event':'checkpoint',
                      'substep':part,'processed':processed,'total':total,
                      'substepElapsedMs':round((now-checkpoint_part_started_at)*1000,1)})
        await self.initialize()
        initialized_at=perf_counter()
        self._query_profile_ms=0.0
        review_all=bool(modes.get('reviewAll',False))
        pos_filter=modes.get('reviewPosFilter',True) is not False
        # Selective audit: review positive local conversions, but do NOT resurrect
        # locally rejected/nonconversion senses or turn unchanged words into targets.
        review_conversions=review_all or bool(modes.get('reviewLocalConversions',False))
        filter_dictionary_people=modes.get('filterDictionaryPeople',False) is True
        # Filter a working view, never mutate the imported dictionary or its
        # globally cached candidate lists. Raw lookups still power name protection.
        async def conversion_lookup(forms):
            result=await self.lookup_candidates_cached(forms)
            if not filter_dictionary_people:return result
            return {form:[record for record in records if not is_dictionary_person(record)]
                    for form,records in result.items()}
        # The original converter owns tokenization, lookup forms, scoring,
        # whole-word precedence and certainty. Do not rescan skipped compounds
        # for general conversion. Exact mixed/cross-origin words have a
        # complete whole-entry choice path below, before source projection.
        converter=ConverterService(self.tokenizer,self.disambiguation)
        # Dictionary probes are exact, but a Kiwi stem can query a longer
        # *lemma* (주/VV -> 주다). Such a match is only a proposal: reject
        # the Hanja spelling before scoring it if it cannot be projected onto
        # the actual original Hangul characters.
        from backend.mixed_origins import align_mixed
        projection_rejected=0
        projection_samples=[]
        def source_candidate_projectable(surface,candidate,token):
            nonlocal projection_rejected
            if not re.fullmatch(r'[가-힣]+',surface) or not safe_replacement(candidate.replacement):
                return True
            display=(converter._build_display_text(token,candidate)
                     if token is not None else candidate.replacement)
            if (token is not None and token.is_verb_stem
                    and token.form.endswith('하')
                    and len(candidate.replacement)<len(token.original)):
                display=candidate.replacement+surface[len(candidate.replacement):]
            display=restore_mixed_display(surface,display,candidate.origin_raw,
                                          token=token,written_form=candidate.written_form)
            # align_mixed intentionally handles mixed-script entries only;
            # plain all-Hanja exact-length forms require their own fast path.
            if (len(display)==len(surface) and all(
                    HANJA.fullmatch(letter) or letter==source
                    for source,letter in zip(surface,display))):
                return True
            if align_mixed(surface,display) is not None:
                return True
            projection_rejected+=1
            if len(projection_samples)<6:
                projection_samples.append(dict(surface=surface,
                    candidate=candidate.replacement,projected=display,
                    dictionary_form=candidate.written_form))
            return False
        phase('kiwi','start')
        tokens=await self.tokens(text)
        tokenized_at=perf_counter()
        phase('kiwi','done',tokenCount=len(tokens))
        phase('converter','start')
        segments,_=await converter.convert(text,conversion_lookup,tokens=tokens,pos_filter=pos_filter,
                                           candidate_filter=source_candidate_projectable,
                                           progress=(lambda part,done,total:checkpoint('converter',part,done,total)) if long_progress else None)
        converted_at=perf_counter()
        phase('converter','done',segmentCount=len(segments))
        phase('names','start')
        # Both name protection and mixed-origin scanning previously rebuilt
        # these same source-aligned compound spans independently.
        from backend.mixed_origins import candidate_spans
        shared_spans=candidate_spans(text,tokens)
        # Preserve the first Kiwi token at each exact span, without searching
        # the full source token array for every converted/reviewed word.
        token_by_span={}
        for token in tokens:
            token_by_span.setdefault((token.start,token.start+token.length),token)
        excluded_person_entries={}
        dictionary_names,homograph_evidence,known_person_hanja=await dictionary_name_evidence(
            text,tokens,self.lookup_candidates_cached,include_person_hanja=True,spans=shared_spans,
            excluded_person_entries=excluded_person_entries)
        kiwi_proper_ranges=proper_noun_ranges(tokens)
        proper_ranges=kiwi_proper_ranges+dictionary_names
        name_protection=modes.get('nameProtection',True) is not False
        homograph_evidence=homograph_evidence if name_protection else []
        conflicting_ranges=[(a,b) for a,b,_,_ in homograph_evidence]
        protected_dictionary_names=[(a,b) for a,b in dictionary_names if (a,b) not in conflicting_ranges]
        inferred_names,surname_ambiguities=await surname_name_evidence(text,tokens,self.lookup_candidates_cached) if name_protection else ([],[])
        protected_names=sorted(set(inferred_names+protected_dictionary_names)) if name_protection else []
        homograph_evidence=[item for item in homograph_evidence if not any(a<=item[0] and item[1]<=b for a,b in protected_names)]
        surname_ambiguities=[item for item in surname_ambiguities if not any(a<item[1] and item[0]<b for a,b in protected_names+dictionary_names)]
        surname_ambiguities=[item for item in surname_ambiguities if not any(a<item[1] and item[0]<b for a,b,_,_ in homograph_evidence)]
        conflicting_ranges=[(a,b) for a,b,_,_ in homograph_evidence]
        suspect_ranges=[(a,b) for a,b,_,_ in surname_ambiguities]
        homograph_targets=[homograph_target(text,a,b,word,[r for r in records if not filter_dictionary_people or not is_dictionary_person(r)],modes) for a,b,word,records in homograph_evidence]
        suspect_targets=[surname_ambiguity_target(text,a,b,word,[r for r in records if not filter_dictionary_people or not is_dictionary_person(r)],modes) for a,b,word,records in surname_ambiguities]
        blocked_for_local=protected_names+conflicting_ranges+suspect_ranges
        names_at=perf_counter()
        phase('names','done',protectedNameCount=len(protected_names))
        phase('mixed','start')
        upstream_counts={f'upstream_{status}':sum(s.status==status for s in segments) for status in ('converted','ambiguous','no_match','kept')}
        mixed=dict(annotations=[],targets=[],ranges=[],skipped_mixed=0)
        if self.dictionary is not None and (modes.get('hanja',True) or modes.get('loanword',False)):
            from backend.mixed_origins import collect_mixed
            whole_word_ranges=[(s.start,s.end) for s in segments if s.selection_reason in ('whole_word_match','whole_word_keep_competition')
                               and s.matched_entry_id not in excluded_person_entries.get((s.start,s.end),())]
            mixed=await collect_mixed(self,text,tokens,{**modes,'reviewAll':review_conversions},whole_word_ranges=whole_word_ranges,blocked_ranges=blocked_for_local,review_ranges=dictionary_names,spans=shared_spans,excluded_entries=excluded_person_entries,
                                      progress=(lambda part,done,total:checkpoint('mixed',part,done,total)) if long_progress else None)
        mixed_at=perf_counter()
        phase('mixed','done',mixedTargetCount=len(mixed['targets']))
        phase('target_choices','start')
        annotations=list(mixed['annotations']); reviews=[]; occupied=list(mixed['ranges']); rejected=0
        mixed_index=_SpanIndex(mixed['ranges'])
        occupied_index=_OccupiedIndex(occupied)
        def valid(start,end,surface):return isinstance(start,int) and isinstance(end,int) and 0<=start<end<=len(text) and text[start:end]==surface
        if long_progress:checkpoint('target_choices','segments',0,len(segments))
        for segment_idx,s in enumerate(segments):
            if long_progress and segment_idx and not (segment_idx & 127):
                checkpoint('target_choices','segments',segment_idx,len(segments))
            if overlaps_proper_noun(s.start,s.end,blocked_for_local):continue
            if s.status not in ('converted','ambiguous'):continue
            if mixed_index.overlaps(s.start,s.end):continue
            if not valid(s.start,s.end,s.original):rejected+=1;continue
            excluded_entries=excluded_person_entries.get((s.start,s.end),())
            if (s.status=='converted' and s.matched_entry_id not in excluded_entries
                    and not review_conversions and not overlaps_proper_noun(s.start,s.end,proper_ranges)):
                if not safe_replacement(s.display_text) or occupied_index.overlaps(s.start,s.end):rejected+=1;continue
                occupied.append((s.start,s.end))
                occupied_index.add(s.start,s.end)
                token=token_by_span.get((s.start,s.end))
                selected=next((c for c in s.candidates if c.get('entry_id')==s.matched_entry_id),{})
                if modes.get('hanja',True):annotations.append(dict(start=to_utf16(text,s.start),end=to_utf16(text,s.end),surface=s.original,type='hanja',replacement=restore_mixed_display(s.original,s.display_text,s.origin_raw,token=token,written_form=selected.get('written_form'))))
            else:
                candidates=[c for c in s.candidates if c.get('entry_id') not in excluded_entries] if excluded_entries else s.candidates
                if candidates:reviews.append((s.start,s.end,s.original,candidates))
        # Only review needs tokens to reproduce the original display builder.
        review_tokens=token_by_span if reviews else {}
        # Match non-converting dictionary senses to exact component spans in
        # O(1) instead of rescanning all review segments for every target.
        review_candidates_by_span={}
        for start,end,_,candidates in reviews:
            review_candidates_by_span.setdefault((start,end),[]).extend(candidates)
        definitions_by_entry=await self.cached_definitions([c.get('entry_id') for _,_,_,candidates in reviews for c in candidates]) if self.dictionary is not None else {}
        choices=[]
        if long_progress:checkpoint('target_choices','reviews',0,len(reviews))
        for review_idx,(start,end,surface,candidates) in enumerate(reviews):
            if long_progress and review_idx and not (review_idx & 127):
                checkpoint('target_choices','reviews',review_idx,len(reviews))
            if not valid(start,end,surface):rejected+=1;continue
            if occupied_index.overlaps(start,end):continue
            for c in candidates:
                replacement=c.get('replacement')
                if (not review_conversions and not overlaps_proper_noun(start,end,proper_ranges) and not c.get('is_reliable')) or not safe_replacement(replacement):continue
                # Preserve inflected Korean suffixes using unchanged upstream display builder.
                token=review_tokens.get((start,end))
                if token is not None:
                    from app.services.disambiguation import CandidateScore
                    score=CandidateScore(**{k:c.get(k) for k in CandidateScore.__dataclass_fields__ if k in c})
                    replacement=converter._build_display_text(token,score)
                    if token.is_verb_stem and token.form.endswith('하') and len(c['replacement'])<len(surface): replacement=c['replacement']+surface[len(c['replacement']):]
                replacement=restore_mixed_display(surface,replacement,c.get('origin_raw'),token=token,written_form=c.get('written_form'))
                if safe_replacement(replacement):choices.append((start,end,replacement,c.get('entry_id')))
        components=[]
        component_end=-1
        for choice in sorted(set(choices)):
            # Connected components depend on the maximal END so far, not the
            # immediately preceding choice end; track it incrementally.
            if not components or choice[0]>=component_end:
                components.append([choice])
                component_end=choice[1]
            else:
                components[-1].append(choice)
                component_end=max(component_end,choice[1])
        targets=[]
        if modes.get('hanja',True):
            for number,component in enumerate(components):
                start=min(x[0] for x in component);end=max(x[1] for x in component)
                options=[dict(choice_id=None,type='keep',replacement=text[start:end],entry_id=None,definitions=[])]
                if self.dictionary is not None:
                    # Dictionary readings that preserve Korean are explicit sense options.
                    # A sense of a subspan cannot explain the whole merged
                    # occurrence; only exact (start,end) senses compete.
                    for candidate in review_candidates_by_span.get((start,end),()):
                        if safe_replacement(candidate.get('replacement')) or not is_nonconversion_origin(candidate.get('origin_raw'),loanword=modes.get('loanword',False)):continue
                        if pos_filter and not review_all and 'pos_mismatch' in (candidate.get('selection_reason') or ''):continue
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
        prepared_targets_at=perf_counter()
        phase('target_choices','done',targetCount=len(targets))
        phase('loanwords','start')
        skipped_mixed=0
        token_entries=None
        if modes.get('loanword',False):
            from backend.loanwords import collect, merge_targets
            token_entries=await self.lookup_entries([t.form for t in tokens],filter_people=filter_dictionary_people)
            entries=token_entries
            # Whole-entry owned words already contain all sibling origins in every mode.
            # Disabled Hanja annotations must not block ordinary loanword lookup.
            loan=collect(text,tokens,entries,(occupied if modes.get('hanja',True) else mixed['ranges'])+blocked_for_local,force_review=review_conversions,hanja_enabled=modes.get('hanja',True),review_ranges=dictionary_names,pos_filter=pos_filter,excluded_entries=excluded_person_entries)
            skipped_mixed=loan['skipped_mixed']
            # A locally certain loan overlapping an original Hanja review becomes
            # a fixed review option instead of pre-empting that connected region.
            hanja_target_index=_SpanIndex((t['start'],t['end']) for t in targets)
            for annotation in loan['annotations']:
                overlapping=hanja_target_index.overlaps(annotation['start'],annotation['end'])
                if overlapping:
                    loan['targets'].append(dict(start=annotation['start'],end=annotation['end'],surface=annotation['surface'],context=text,options=[dict(choice_id=None,type='keep',replacement=annotation['surface'],entry_id=None,definitions=[]),dict(choice_id='c0',type='loanword',replacement=annotation['replacement'],entry_id=annotation['entry_id'],definitions=annotation['definitions'])]))
                else:annotations.append({k:v for k,v in annotation.items() if k not in ('entry_id','definitions')})
            targets=merge_targets(text,targets+loan['targets'])
        loanwords_at=perf_counter()
        phase('loanwords','done',targetCount=len(targets))
        phase('audits','start')
        targets=sorted(targets+mixed['targets']+homograph_targets+suspect_targets,key=lambda t:(t['start'],t['end']))
        if (self.dictionary is not None and modes.get('hanja',True)
                and hasattr(self.dictionary,'batch_lookup_entries') and type(self.dictionary) is DictionaryService):
            from backend.spaced_phrases import add_spaced_hanja_candidates
            await add_spaced_hanja_candidates(self,text,tokens,shared_spans,targets,annotations,
                proper_ranges+blocked_for_local)
            targets.sort(key=lambda t:(t['start'],t['end']))
        # Only opt-in experimental Latin review gets additional proper-name
        # targets. Keep local person protection: these have only null/no-conversion options,
        # never an automatic conversion or a speculative Hanja reading.
        if modes.get('experimentalLoanwordAudit',False) and modes.get('loanword',False):
            covered=_SpanIndex([(t['start'],t['end']) for t in targets]+
                               [(a['start'],a['end']) for a in annotations])
            dictionary_name_spans=set(dictionary_names)
            for token in tokens:
                a=token.start;b=a+token.length
                if token.tag.split('-')[0]!='NNP' and (a,b) not in dictionary_name_spans:continue
                if not (0<=a<b<=len(text)):continue
                word=text[a:b]
                if not re.fullmatch(r'[가-힣]{2,80}',word) or token.form!=word:continue
                # Never take only one component of a longer lexical word.
                if a and '가'<=text[a-1]<='힣':continue
                if b<len(text) and '가'<=text[b]<='힣':
                    right=next((t for t in tokens if t.start==b),None)
                    if right is None or not right.tag.startswith('J'):continue
                start=to_utf16(text,a);end=to_utf16(text,b)
                if covered.overlaps(start,end):continue
                targets.append(dict(target_id='latin-audit',start=start,end=end,surface=word,
                    context=text,experimental_loanword_audit=True,
                    options=[dict(choice_id=None,type='keep',replacement=word,
                                  entry_id=None,definitions=[])]))
                covered.add(start,end)
            targets.sort(key=lambda t:(t['start'],t['end']))
        # Experimental Hanja audit is independent of Kiwi segmentation repair.
        # Only complete, dictionary-uncovered Kiwi nominal spans are reviewed;
        # a known native word is NOT an extra target merely for being a noun.
        # Keep proper-name protection and all existing local results intact.
        if (self.dictionary is not None and modes.get('experimentalHanjaAudit',False)
                and modes.get('hanja',False)):
            candidates=[]
            audit_occupied=_SpanIndex([(t['start'],t['end']) for t in targets]+
                                      [(x['start'],x['end']) for x in annotations])
            for token in tokens:
                a=token.start;b=a+token.length
                if token.tag.split('-')[0] not in {'NNG','NNP'}:continue
                if not (0<=a<b<=len(text)):continue
                word=text[a:b]
                if not 2<=len(word)<=8 or not re.fullmatch(r'[가-힣]+',word) or token.form!=word:continue
                if overlaps_proper_noun(a,b,protected_names+dictionary_names+suspect_ranges+conflicting_ranges):continue
                start=to_utf16(text,a);end=to_utf16(text,b)
                if audit_occupied.overlaps(start,end):continue
                candidates.append((token,a,b,word,start,end))
            if candidates:
                # One batched dictionary lookup. When the loanword pass already
                # looked up raw entries, reuse its result without a second query.
                words=list(dict.fromkeys(c[3] for c in candidates))
                records=(token_entries if token_entries is not None and not filter_dictionary_people
                         else await self.lookup_entries(words,filter_people=False))
                unknown=[c for c in candidates if not records.get(c[3])]
                # A surname prefix is strong person-name evidence even if Kiwi
                # mistakenly tagged the whole personal name as a common noun.
                prefixes=list(dict.fromkeys(p for _,_,_,word,_,_ in unknown
                            for p in (word[:1],word[:2]) if len(p)<len(word)))
                prefix_entries=await self.lookup_candidates_cached(prefixes) if prefixes else {}
                cap=max(12,min(80,len(text)//12))
                # Prioritize ordinary nouns over uncertain proper nouns under
                # the budget; preserve original source order for display.
                selected=sorted(unknown,key=lambda c:(c[0].tag.split('-')[0]=='NNP',c[1]))[:cap]
                target_index=_SpanIndex((t['start'],t['end']) for t in targets)
                for token,a,b,word,start,end in sorted(selected,key=lambda c:c[1]):
                    if any(r.get('surname_usage') is True for p in (word[:1],word[:2])
                           if len(p)<len(word) for r in prefix_entries.get(p,[])):
                        continue
                    if target_index.overlaps(start,end):
                        continue
                    targets.append(dict(target_id='hanja-audit',start=start,end=end,surface=word,
                        context=text,experimental_hanja_audit=True,
                        options=[dict(choice_id=None,type='keep',replacement=word,
                                      entry_id=None,definitions=[])]))
                    target_index.add(start,end)
                targets.sort(key=lambda t:(t['start'],t['end']))
        # Only when dictionary-person filtering is OFF, provide exact,
        # dictionary-backed Hanja personal names as review candidates.
        # Keep unfiltered dictionary name evidence for name protection, but
        # never reintroduce a filtered person sense through this pathway.
        if modes.get('hanja',True) and not filter_dictionary_people:
            for (a,b),records in known_person_hanja.items():
                start=to_utf16(text,a);end=to_utf16(text,b)
                if any(start<x['end'] and x['start']<end for x in annotations):continue
                overlapping=[t for t in targets if start<t['end'] and t['start']<end]
                if overlapping and any(t['start']!=start or t['end']!=end for t in overlapping):
                    continue
                target=overlapping[0] if overlapping else dict(
                    start=start,end=end,surface=text[a:b],context=text,
                    options=[dict(choice_id=None,type='keep',replacement=text[a:b],
                                  entry_id=None,definitions=[])])
                if not overlapping:targets.append(target)
                trusted=target.setdefault('verified_person_hanja',[])
                for record in records:
                    origin=record['replacement']
                    if origin not in trusted:trusted.append(origin)
                    if any(o.get('entry_id')==record['entry_id'] and
                           o.get('replacement')==origin for o in target['options']):
                        continue
                    target['options'].append(dict(
                        choice_id='person-dictionary',type='hanja',replacement=origin,
                        entry_id=record['entry_id'],definitions=record['definitions']))
                target['dictionary_person_name']=True
            targets.sort(key=lambda t:(t['start'],t['end']))
        audits_at=perf_counter()
        phase('audits','done',targetCount=len(targets))
        phase('target_finalize','start')
        # Complete every candidate, including sibling origins owned by mixed words.
        option_definitions=await self.cached_definitions([o['entry_id'] for t in targets for o in t['options'] if o['type']!='keep']) if self.dictionary is not None else {}
        option_metadata=await self.cached_metadata(option_definitions) if self.dictionary is not None else {}
        filtered_person_only=set()
        for target in targets:
            native=[];conversions=[];seen=set()
            removed_person_sense=False
            for option in target['options']:
                if option['type']=='keep':continue
                option={**option,**option_metadata.get(option['entry_id'],{})}
                definitions=option_definitions.get(option['entry_id'],option['definitions'])
                if option.get('phrase_origin'):
                    definitions=[f"Complete dictionary phrase: {option['phrase_origin']}",*definitions]
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
            target['options']=[dict(choice_id=None,type='keep',replacement=target['surface'],entry_id=None,definitions=[])]+native+conversions
            if removed_person_sense and not native and not conversions:
                filtered_person_only.add(id(target))
        # Do not send person-only remnants (null choice with no lexical sense) to the
        # model, which could otherwise invent an experimental origin for a name.
        if filtered_person_only:
            targets=[target for target in targets if id(target) not in filtered_person_only]
        # Encode each token boundary once, not once per review target.
        # This retains the existing surrogate/astral offset conversion exactly.
        token_morphology=[dict(form=t.form,tag=t.tag,start=to_utf16(text,t.start),end=to_utf16(text,t.start+t.length)) for t in tokens]
        # Token ranges usually follow source order. Use binary search once
        # per target instead of searching the entire long document repeatedly.
        token_ends=[m['end'] for m in token_morphology]
        monotonic_tokens=all(token_morphology[i-1]['start']<=token_morphology[i]['start']
                             and token_ends[i-1]<=token_ends[i]
                             for i in range(1,len(token_morphology)))
        kiwi_proper_index=_SpanIndex((to_utf16(text,a),to_utf16(text,b)) for a,b in kiwi_proper_ranges)
        dictionary_name_spans={(to_utf16(text,a),to_utf16(text,b)) for a,b in dictionary_names}
        dictionary_name_index=_SpanIndex(dictionary_name_spans)
        if long_progress:checkpoint('target_finalize','targets',0,len(targets))
        for i,target in enumerate(targets):
            if long_progress and i and not (i & 127):
                checkpoint('target_finalize','targets',i,len(targets))
            target['target_id']=f't{i}'
            a=target['start'];b=target['end']
            if monotonic_tokens:
                first=bisect_right(token_ends,a)
                matching=[]
                while first<len(token_morphology):
                    m=token_morphology[first]
                    if m['start']>=b:break
                    if a<m['end']:matching.append(dict(m))
                    first+=1
                target['morphology']=matching
            else:
                # Overlapping or out-of-order tokenizers keep original logic.
                target['morphology']=[dict(m) for m in token_morphology
                                      if m['start']<b and a<m['end']]
            exact_name=(a,b) in dictionary_name_spans
            if exact_name or kiwi_proper_index.overlaps(a,b):target['proper_noun']=True
            if exact_name:
                target['dictionary_person_name']=True
            elif dictionary_name_index.overlaps(a,b):
                target['dictionary_name_overlap']=True
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
        finished_at=perf_counter()
        phase('target_finalize','done',targetCount=len(targets))
        timing_ms={k:round(v,3) for k,v in dict(
            initialize=(initialized_at-analyzed_at)*1000,
            kiwi=(tokenized_at-initialized_at)*1000,
            converter=(converted_at-tokenized_at)*1000,
            names=(names_at-converted_at)*1000,
            mixed=(mixed_at-names_at)*1000,
            targets=(finished_at-mixed_at)*1000,
            target_choices=(prepared_targets_at-mixed_at)*1000,
            loanwords=(loanwords_at-prepared_targets_at)*1000,
            audits=(audits_at-loanwords_at)*1000,
            target_finalize=(finished_at-audits_at)*1000,
            sqlite_queries=self._query_profile_ms,
            total=(finished_at-analyzed_at)*1000).items()}
        return dict(engine_version=ENGINE_VERSION,dictionary_fingerprint=self.fingerprint,annotations=annotations,targets=targets,**repair_context,stats=dict(timings_ms=timing_ms,token_count=len(tokens),option_count=sum(len(t['options']) for t in targets),segment_count=len(segments),local_determined=len(annotations),pending=len(targets),protected_names=len(protected_names),structural_rejections=rejected,upstream_alignment_pruned=projection_rejected,
            upstream_alignment_samples=projection_samples,
            skipped_mixed=skipped_mixed+mixed['skipped_mixed'],**upstream_counts))

_default_engine=None
async def analyze(text: str,modes: dict) -> dict:
    global _default_engine
    if _default_engine is None:_default_engine=Engine()
    return await _default_engine.analyze(text,modes)
