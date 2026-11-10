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
        self.assertEqual(no_protection['targets'],[])

    async def test_multiword_lexical_caret_maps_to_original_word_segments(self):
        entry=self.add('이산화^탄소','二酸化炭素','명사','탄소의 산화물.')
        from app.services.dictionary import DictionaryService
        dictionary=DictionaryService(str(self.path))
        for query in ['이산화 탄소','이산화탄소','이산화^탄소']:
            candidates=(await dictionary.batch_lookup_candidates([query]))[query]
            self.assertTrue(any(r['entry_id']==entry and r['replacement']=='二酸化炭素'
                                and r['is_reliable'] for r in candidates),(query,candidates))
        from backend.mixed_origins import candidate_spans
        source='이산화 탄소'
        t=self.tokenizer_for([('이산화','NNG',0),('탄소','NNG',4)])
        tokens=await t.tokenize_async(source)
        self.assertIn((0,len(source),source),candidate_spans(source,tokens,include_spaced=True))
        model=await Engine(self.path,tokenizer=t).analyze(source,
           dict(hanja=True,loanword=False,nameProtection=False,filterDictionaryPeople=True))
        self.assertEqual([(a['surface'],a['replacement'],a['start'],a['end']) for a in model['annotations']],
                         [('이산화','二酸化',0,3),('탄소','炭素',4,6)],model)
        audited=await Engine(self.path,tokenizer=t).analyze(source,
           dict(hanja=True,loanword=False,nameProtection=False,filterDictionaryPeople=True,reviewLocalConversions=True))
        self.assertEqual(audited['annotations'],[])
        candidate=next(o for target in audited['targets'] for o in target['options']
                       if o['type']=='hanja' and o['replacement']=='二酸化 炭素')
        self.assertEqual(len(candidate['segments']),2)
        self.assertEqual([(p['surface'],p['replacement']) for p in candidate['segments']],
                         [('이산화','二酸化'),('탄소','炭素')])

    async def test_four_word_phrase_preserves_every_whitespace_boundary(self):
        entry=self.add('주^연료^차단^장치','主燃料遮斷裝置','명사','연료를 차단하는 장치.')
        source='주 연료 차단 장치'
        t=self.tokenizer_for([('주','NNG',0),('연료','NNG',2),('차단','NNG',5),('장치','NNG',8)])
        from app.services.dictionary import DictionaryService
        dictionary=DictionaryService(str(self.path))
        self.assertTrue(any(r['id']==entry for r in (await dictionary.batch_lookup_entries([source]))[source]))
        result=await Engine(self.path,tokenizer=t).analyze(source,
            dict(hanja=True,loanword=False,nameProtection=False,filterDictionaryPeople=True))
        # The fixture already contains a second entry with identical phrase
        # but missing POS; a competing entry correctly forces model review.
        self.assertEqual(result['annotations'],[],result)
        candidates=[o for t in result['targets'] for o in t['options']
                    if o.get('entry_id')==entry and o.get('type')=='hanja']
        self.assertEqual(len(candidates),1,result)
        self.assertEqual([(p['surface'],p['replacement']) for p in candidates[0]['segments']],
            [('주','主'),('연료','燃料'),('차단','遮斷'),('장치','裝置')],result)

    async def test_aliases_do_not_resurrect_a_translation_or_cross_punctuation(self):
        self.add('이산화^탄소','二酸化炭素','명사','chemical name')
        from app.services.dictionary import DictionaryService
        dictionary=DictionaryService(str(self.path))
        rows=await dictionary.batch_lookup_entries(['이산화, 탄소','이산화 탄소','이산화\n탄소'])
        self.assertEqual(rows['이산화, 탄소'],[])
        self.assertEqual(rows['이산화\n탄소'],[])
        self.assertTrue(rows['이산화 탄소'])

if __name__=='__main__':
    unittest.main(verbosity=2)
