import sqlite3
import types
import unittest
from test_quantity_bonus import Tests,tokenizer
from backend.analysis import Engine
from backend.orthographic_aliases import canonical_headword,headword_aliases

class HeadwordAliases(unittest.IsolatedAsyncioTestCase):
    asyncSetUp=Tests.asyncSetUp
    asyncTearDown=Tests.asyncTearDown
    add=Tests.add

    def tokenizer_for(self,tokens):
        t=tokenizer()
        t._kiwi=types.SimpleNamespace(tokenize=lambda text:[
            types.SimpleNamespace(form=form,tag=tag,start=offset,len=len(form))
            for form,tag,offset in tokens])
        return t

    async def test_exact_indexed_aliases_for_hyphen_caret_and_spaces(self):
        self.assertEqual(canonical_headword('안-중근'),'안중근')
        self.assertEqual(canonical_headword('이산화^탄소'),'이산화탄소')
        self.assertIn('안-중근',headword_aliases('안중근'))
        self.assertIn('이산화^탄소',headword_aliases('이산화 탄소'))
        self.assertIn('이산화^탄소',headword_aliases('이산화탄소'))
        self.assertIn('주^연료^차단^장치',headword_aliases('주 연료 차단 장치'))
        self.assertNotIn('안중근',headword_aliases('안녕하세요!'))
        self.assertLessEqual(len(headword_aliases('이산화 탄소')),96)
        self.assertEqual(headword_aliases('학교, 탄소'),('학교, 탄소',))

    async def test_person_name_alias_is_visible_to_protection_but_filtered_as_a_conversion(self):
        person=self.add('안-중근','安重根','명사','독립운동가.')
        with sqlite3.connect(self.path) as db:
            db.execute("UPDATE entries SET subject_category='人名' WHERE id=?",(person,))
        from app.services.dictionary import DictionaryService
        dictionary=DictionaryService(str(self.path))
        records=await dictionary.batch_lookup_candidates(['안중근','안-중근'])
        self.assertTrue(any(r['entry_id']==person for r in records['안중근']))
        self.assertTrue(any(r['entry_id']==person for r in records['안-중근']))
        t=self.tokenizer_for([('안중근','NNG',0)])
        protected=await Engine(self.path,tokenizer=t).analyze('안중근',
            dict(hanja=True,loanword=False,nameProtection=True,filterDictionaryPeople=True))
        self.assertEqual(protected['annotations'],[])
        self.assertGreater(protected['stats']['protected_names'],0)
        no_protection=await Engine(self.path,tokenizer=t).analyze('안중근',
            dict(hanja=True,loanword=False,nameProtection=False,filterDictionaryPeople=True))
        self.assertEqual(no_protection['annotations'],[])
        self.assertEqual(no_protection['targets'],[],no_protection)
        allow_person=await Engine(self.path,tokenizer=t).analyze('안중근',
            dict(hanja=True,loanword=False,nameProtection=False,filterDictionaryPeople=False))
        person_target=next(t for t in allow_person['targets'] if t['surface']=='안중근')
        self.assertEqual(person_target['verified_person_hanja'],['安重根'])
        self.assertTrue(any(o['entry_id']==person and o['replacement']=='安重根'
                            for o in person_target['options'] if o['type']=='hanja'))

    async def test_dictionary_queries_keep_spaced_variants_but_targets_never_cross_spaces(self):
        entry=self.add('이산화^탄소','二酸化炭素','명사','탄소의 산화물.')
        from app.services.dictionary import DictionaryService
        from backend.mixed_origins import candidate_spans
        dictionary=DictionaryService(str(self.path))
        for query in ['이산화 탄소','이산화탄소','이산화^탄소']:
            candidates=(await dictionary.batch_lookup_candidates([query]))[query]
            self.assertTrue(any(r['entry_id']==entry and r['replacement']=='二酸化炭素'
                                and r['is_reliable'] for r in candidates),(query,candidates))
        spaced='이산화 탄소'
        separate=self.tokenizer_for([('이산화','NNG',0),('탄소','NNG',4)])
        separate_tokens=await separate.tokenize_async(spaced)
        self.assertFalse(any(' ' in word for _,_,word in candidate_spans(spaced,separate_tokens)))
        model=await Engine(self.path,tokenizer=separate).analyze(spaced,
           dict(hanja=True,loanword=False,nameProtection=False,filterDictionaryPeople=True))
        self.assertFalse(any(' ' in t['surface'] for t in model['targets']))
        self.assertFalse(any(a['start']<3 and a['end']>3 for a in model['annotations']))

        # An unspaced source can still resolve a dictionary headword stored
        # with a literal gap or caret. The lookup alias is NOT removed.
        contiguous='이산화탄소'
        joined=self.tokenizer_for([('이산화','NNG',0),('탄소','NNG',3)])
        joined_tokens=await joined.tokenize_async(contiguous)
        self.assertIn((0,len(contiguous),contiguous),candidate_spans(contiguous,joined_tokens))
        audited=await Engine(self.path,tokenizer=joined).analyze(contiguous,
           dict(hanja=True,loanword=False,nameProtection=False,filterDictionaryPeople=True,
                reviewLocalConversions=True))
        options=[o for t in audited['targets'] for o in t['options']
                 if o['type']=='hanja' and o['replacement']=='二酸化炭素']
        self.assertTrue(options,audited)

    async def test_four_word_dictionary_phrase_is_searchable_but_never_a_cross_space_target(self):
        entry=self.add('주^연료^차단^장치','主燃料遮斷裝置','명사','연료를 차단하는 장치.')
        source='주 연료 차단 장치'
        t=self.tokenizer_for([('주','NNG',0),('연료','NNG',2),('차단','NNG',5),('장치','NNG',8)])
        from app.services.dictionary import DictionaryService
        from backend.mixed_origins import candidate_spans
        dictionary=DictionaryService(str(self.path))
        self.assertTrue(any(r['id']==entry for r in (await dictionary.batch_lookup_entries([source]))[source]))
        tokens=await t.tokenize_async(source)
        self.assertFalse(any(' ' in word for _,_,word in candidate_spans(source,tokens)))
        result=await Engine(self.path,tokenizer=t).analyze(source,
            dict(hanja=True,loanword=False,nameProtection=False,filterDictionaryPeople=True))
        self.assertFalse(any(' ' in target['surface'] for target in result['targets']))
        # Only real individual source words may receive annotations.
        self.assertFalse(any(' ' in a['surface'] for a in result['annotations']))

    async def test_unrelated_cross_space_syllables_never_become_dictionary_targets(self):
        from backend.mixed_origins import candidate_spans
        for source,tokens in [
            ('재무부 등의', [('재무','NNG',0),('부','NNG',2),('등','NNB',4)]),
            ('황 전 CEO', [('황','NNP',0),('전','MM',2)]),
            ('아이돌급 환호', [('아이돌','NNG',0),('급','XSN',3),('환','NNG',5),('호','NNB',6)])
        ]:
            t=self.tokenizer_for(tokens)
            spans=candidate_spans(source,await t.tokenize_async(source))
            self.assertFalse(any(' ' in word for _,_,word in spans),(source,spans))
            self.assertNotIn('부 등',[word for _,_,word in spans])
            self.assertNotIn('황 전',[word for _,_,word in spans])
            self.assertNotIn('급 환',[word for _,_,word in spans])

    async def test_aliases_do_not_resurrect_a_translation_or_cross_punctuation(self):
        self.add('이산화^탄소','二酸化炭素','명사','chemical name')
        from app.services.dictionary import DictionaryService
        dictionary=DictionaryService(str(self.path))
        rows=await dictionary.batch_lookup_entries(['이산화, 탄소','이산화 탄소','이산화\n탄소'])
        self.assertEqual(rows['이산화, 탄소'],[])
        self.assertEqual(rows['이산화\n탄소'],[])
        self.assertTrue(rows['이산화 탄소'])


    async def test_spaced_hanja_phrase_supplies_independent_review_candidates(self):
        entry=self.add('일산화^탄소','一酸化炭素',None,'일산화 탄소의 설명.')
        source='일산화 탄소'
        t=self.tokenizer_for([('일산화','NNG',0),('탄소','NNG',4)])
        result=await Engine(self.path,tokenizer=t).analyze(source,
            dict(hanja=True,loanword=False,nameProtection=False))
        self.assertEqual([t['surface'] for t in result['targets']],['일산화','탄소'])
        for target,expected in zip(result['targets'],['一酸化','炭素']):
            option=next(o for o in target['options'] if o.get('entry_id')==entry)
            self.assertEqual(option['replacement'],expected)
            self.assertEqual(option['phrase_origin'],'일산화 탄소 (一酸化炭素)')
            self.assertIn('一酸化炭素',option['definitions'][0])
            self.assertIn('일산화 탄소의 설명.',option['definitions'])
        self.assertEqual(result['annotations'],[])

    async def test_spaced_phrase_before_particle_and_not_across_punctuation(self):
        entry=self.add('일산화 탄소','一酸化炭素',None,'화학 용어.')
        for source,parts,expected in [
            ('일산화 탄소는',[('일산화','NNG',0),('탄소','NNG',4),('는','JX',6)],True),
            ('일산화, 탄소',[('일산화','NNG',0),('탄소','NNG',5)],False),
            ('일산화\\n탄소',[('일산화','NNG',0),('탄소','NNG',4)],False)]:
            source=source.replace('\\n','\n')
            result=await Engine(self.path,tokenizer=self.tokenizer_for(parts)).analyze(source,
                dict(hanja=True,loanword=False,nameProtection=False))
            options=[o for t in result['targets'] for o in t['options'] if o.get('entry_id')==entry]
            self.assertTrue(options,(source,result))  # Orphans may now use the same phrase evidence.
            self.assertFalse(any(' ' in t['surface'] for t in result['targets']))
            self.assertFalse(any(' ' in t['surface'] for t in result['targets']))

    async def test_orphan_component_index_and_existing_standalone(self):
        entry=self.add('일산화^탄소','一酸化炭素',None,'화학 용어.')
        engine=Engine(self.path,tokenizer=self.tokenizer_for([('일산화','NNG',0)]))
        modes=dict(hanja=True,loanword=False,nameProtection=False)
        result=await engine.analyze('일산화',modes)
        self.assertEqual(result['annotations'],[])
        self.assertTrue(any(o.get('entry_id')==entry and o['replacement']=='一酸化' for t in result['targets'] for o in t['options']))
        index=await engine.dictionary.load_phrase_index()
        self.assertIs(index,await engine.dictionary.load_phrase_index())
        self.add('일산화',None,'명사','다른 뜻.')
        other=await Engine(self.path,tokenizer=self.tokenizer_for([('일산화','NNG',0)])).analyze('일산화',modes)
        self.assertFalse(any(o.get('entry_id')==entry for t in other['targets'] for o in t['options']))

    async def test_foreign_and_mixed_phrase_components(self):
        from backend.spaced_phrases import align_phrase
        self.assertIsNone(align_phrase('아이스^크림','icecream'))
        self.assertEqual(align_phrase('아이스^크림','ice cream')[1][0][0]['replacement'],'ice')
        self.assertEqual(align_phrase('인터넷^방송','internet放送')[1][1][0]['replacement'],'放送')
        entry=self.add('인터넷^방송','internet放送',None,'방송의 한 종류.')
        result=await Engine(self.path,tokenizer=self.tokenizer_for([('인터넷','NNG',0)])).analyze('인터넷',
            dict(hanja=False,loanword=True,nameProtection=False))
        self.assertEqual(result['annotations'],[])
        self.assertTrue(any(o.get('entry_id')==entry and o['type']=='loanword' and o['replacement']=='internet' for t in result['targets'] for o in t['options']))
        result=await Engine(self.path,tokenizer=self.tokenizer_for([('방송','NNG',0)])).analyze('방송',
            dict(hanja=True,loanword=False,nameProtection=False))
        self.assertTrue(any(o.get('entry_id')==entry and o['replacement']=='放送' for t in result['targets'] for o in t['options']))

    async def test_hyphen_dictionary_components_are_review_only(self):
        from backend.spaced_phrases import align_phrase
        entry=self.add('사산화-물','四酸化物',None,'화학 용어.')
        modes=dict(hanja=True,loanword=False,nameProtection=False)
        for source,tokens,wanted in [
            ('사산화',[('사산화','NNG',0)],{'사산화':'四酸化'}),
            ('물',[('물','NNG',0)],{'물':'物'}),
            ('사산화 물',[('사산화','NNG',0),('물','NNG',4)],{'사산화':'四酸化','물':'物'}),
        ]:
            result=await Engine(self.path,tokenizer=self.tokenizer_for(tokens)).analyze(source,modes)
            self.assertEqual(result['annotations'],[])
            actual={t['surface']:o['replacement'] for t in result['targets']
                    for o in t['options'] if o.get('entry_id')==entry}
            self.assertEqual(actual,wanted,(source,result))
            self.assertFalse(any(' ' in t['surface'] for t in result['targets']))
        self.assertEqual(align_phrase('인터넷-방송','internet放送')[1][0][0]['replacement'],'internet')
        self.assertEqual(align_phrase('아이스-크림','ice cream')[1][1][0]['replacement'],'cream')
        self.assertIsNone(align_phrase('아이스-크림','icecream'))
        for title in ['-사산화','사산화-','사산화--물','사산화 -물']:
            self.assertIsNone(align_phrase(title,'四酸化物'))
        self.add('물',None,'명사','물의 다른 뜻.')
        result=await Engine(self.path,tokenizer=self.tokenizer_for([('물','NNG',0)])).analyze('물',modes)
        self.assertFalse(any(o.get('entry_id')==entry for t in result['targets'] for o in t['options']))

if __name__=='__main__':
    unittest.main(verbosity=2)
