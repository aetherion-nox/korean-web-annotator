import sqlite3
import types
import unittest
from test_quantity_bonus import Tests, tokenizer
from backend.analysis import Engine
from backend.proper_nouns import is_dictionary_person

class FilterDictionaryPeople(unittest.IsolatedAsyncioTestCase):
    asyncSetUp=Tests.asyncSetUp
    asyncTearDown=Tests.asyncTearDown
    add=Tests.add

    def token(self,word,tag='NNG'):
        source=tokenizer()
        source._kiwi=types.SimpleNamespace(tokenize=lambda _: [
            types.SimpleNamespace(form=word,tag=tag,start=0,len=len(word))
        ])
        return source

    def person(self,word,origin,category='인명',field='subject_category'):
        entry=self.add(word,origin,'명사','person name')
        with sqlite3.connect(self.path) as db:
            db.execute(f'UPDATE entries SET {field}=? WHERE id=?',(category,entry))
        return entry

    async def run_case(self,word,*,filter_people,name_protection=False,hanja=True,loanword=True,review=False):
        return await Engine(self.path,tokenizer=self.token(word)).analyze(
            word,dict(hanja=hanja,loanword=loanword,nameProtection=name_protection,
                      filterDictionaryPeople=filter_people,reviewLocalConversions=review))

    async def test_person_only_hanja_is_suppressed_when_filter_enabled(self):
        person=self.person('이수민','李壽民')
        self.assertTrue(is_dictionary_person({'subject_category':'인명'}))
        self.assertFalse(is_dictionary_person({'subject_category':'일반어'}))
        unfiltered=await self.run_case('이수민',filter_people=False)
        self.assertTrue(unfiltered['annotations'] or unfiltered['targets'],unfiltered)
        filtered=await self.run_case('이수민',filter_people=True)
        self.assertEqual(filtered['annotations'],[])
        self.assertEqual(filtered['targets'],[],filtered)
        reviewed=await self.run_case('이수민',filter_people=True,review=True)
        self.assertEqual(reviewed['annotations'],[])
        self.assertEqual(reviewed['targets'],[],reviewed)
        explicit=await self.run_case('이수민',filter_people=False,review=True)
        self.assertTrue(any(o.get('entry_id')==person and o['replacement']=='李壽民'
                            for t in explicit['targets'] for o in t['options']),explicit)

    async def test_person_loanword_and_mixed_are_filtered_without_rediscovery(self):
        for word,origin in [('마이클','Michael'),('김게임','金game')]:
            self.person(word,origin,'人名','semantic_category')
            for review in [False,True]:
                filtered=await self.run_case(word,filter_people=True,review=review)
                self.assertEqual(filtered['annotations'],[],(word,filtered))
                self.assertEqual(filtered['targets'],[],(word,filtered))
            ordinary=await self.run_case(word,filter_people=False)
            self.assertTrue(ordinary['annotations'] or ordinary['targets'],(word,ordinary))

    async def test_homograph_ordinary_sense_survives_person_filter(self):
        person=self.person('학교','李校','personal name')
        result=await self.run_case('학교',filter_people=True,name_protection=False,review=True)
        options=[o for target in result['targets'] for o in target['options'] if o['type']!='keep']
        self.assertTrue(any(o['replacement']=='學校' for o in options),result)
        self.assertFalse(any(o.get('entry_id')==person for o in options),result)
        off=await self.run_case('학교',filter_people=False,name_protection=False,review=True)
        self.assertTrue(any(o.get('entry_id')==person for t in off['targets'] for o in t['options']),off)

    async def test_name_protection_remains_separate_from_dictionary_filter(self):
        self.person('이수민','李壽民')
        protected=await self.run_case('이수민',filter_people=False,name_protection=True)
        self.assertEqual(protected['annotations'],[])
        self.assertEqual(len(protected['targets']),1)
        self.assertEqual(protected['targets'][0]['verified_person_hanja'],['李壽民'])
        self.assertGreater(protected['stats']['protected_names'],0)
        filtered=await self.run_case('이수민',filter_people=True,name_protection=True)
        self.assertEqual(filtered['annotations'],[])
        self.assertGreater(filtered['stats']['protected_names'],0)
        self.assertEqual(filtered['targets'],[],filtered)

    async def test_historical_biography_without_category_is_filtered(self):
        # Real dictionaries sometimes supply "人名" only in an external
        # dictionary renderer, while the imported DB category is blank.
        from backend.proper_nouns import is_person_biography
        gloss='통일 신라 시대의 장군(?~846). 본명은 궁복(弓福)·궁파(弓巴).'
        self.assertTrue(is_person_biography(gloss))
        self.assertFalse(is_person_biography('군대의 장군을 가리키는 말.'))
        self.assertFalse(is_person_biography('장군이 등장하는 소설. 1984년에 발표하였다.'))
        self.assertFalse(is_person_biography('핵잠수함에 붙인 함급의 이름.'))
        name=self.add('장-보고','張保皐','명사',gloss)
        with sqlite3.connect(self.path) as db:
            row=db.execute('SELECT subject_category,semantic_category FROM entries WHERE id=?',(name,)).fetchone()
            self.assertEqual(row,(None,None))
        protected=await self.run_case('장보고',filter_people=True,name_protection=True)
        self.assertEqual(protected['annotations'],[],protected)
        self.assertEqual(protected['targets'],[],protected)
        filtered=await self.run_case('장보고',filter_people=True,name_protection=False,review=True)
        self.assertEqual(filtered['annotations'],[],filtered)
        self.assertEqual(filtered['targets'],[],filtered)
        unfiltered=await self.run_case('장보고',filter_people=False,name_protection=False,review=True)
        self.assertTrue(any(o.get('entry_id')==name for t in unfiltered['targets']
                            for o in t['options']),unfiltered)

    async def test_hyphenated_biographical_lee_jae_myeong_respects_toggle(self):
        # Real dictionary layout: 이-재명 -> 李在明, a historical biography.
        # An identical modern person's spelling must not bypass an OFF filter.
        entry=self.add('이-재명','李在明','명사',
                       '독립운동가(1890~1910). 명동 성당에서 이완용을 습격하였다.')
        with sqlite3.connect(self.path) as db:
            db.execute("UPDATE entries SET semantic_category='人名' WHERE id=?",(entry,))
        from app.services.dictionary import DictionaryService
        dictionary=DictionaryService(str(self.path))
        self.assertTrue(any(r['entry_id']==entry for r in
                            (await dictionary.batch_lookup_candidates(['이재명']))['이재명']))
        for name_protection in (True,False):
            for review in (True,False):
                for experimental in (True,False):
                    engine=Engine(self.path,tokenizer=self.token('이재명','NNP'))
                    filtered=await engine.analyze('이재명',dict(
                        hanja=True,loanword=False,nameProtection=name_protection,
                        filterDictionaryPeople=True,reviewLocalConversions=review,
                        experimentalHanjaAudit=experimental))
                    self.assertEqual(filtered['annotations'],[],filtered)
                    self.assertFalse(any(
                        o.get('entry_id')==entry or o.get('replacement')=='李在明'
                        for t in filtered['targets'] for o in t['options']),filtered)
                    self.assertFalse(any('李在明' in t.get('verified_person_hanja',[])
                                         for t in filtered['targets']),filtered)
        permitted=await self.run_case('이재명',filter_people=False,review=True)
        matching=[o for t in permitted['targets'] for o in t['options']
                  if o.get('entry_id')==entry and o.get('replacement')=='李在明']
        self.assertEqual(len(matching),1,permitted)
        self.assertTrue(any('李在明' in t.get('verified_person_hanja',[])
                            for t in permitted['targets']),permitted)

    async def test_historical_person_homograph_does_not_remove_ordinary_sense(self):
        gloss='통일 신라 시대의 장군(?~846). 본명은 궁복(弓福).'
        person=self.add('장보고','張保皐','명사',gloss)
        ordinary=self.add('장보고','長保庫','명사','특정 물건을 보관하는 창고.')
        result=await self.run_case('장보고',filter_people=True,name_protection=False,review=True)
        ids=[o.get('entry_id') for t in result['targets'] for o in t['options']]
        self.assertNotIn(person,ids,result)
        self.assertIn(ordinary,ids,result)
        off=await self.run_case('장보고',filter_people=False,name_protection=False,review=True)
        self.assertTrue(any(o.get('entry_id')==person for t in off['targets'] for o in t['options']),off)

if __name__=='__main__':
    unittest.main(verbosity=2)
