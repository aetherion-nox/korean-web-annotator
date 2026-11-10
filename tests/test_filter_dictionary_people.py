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

    async def test_person_only_hanja_is_excluded_from_converter_and_review(self):
        person=self.person('이수민','李壽民')
        self.assertTrue(is_dictionary_person({'subject_category':'인명'}))
        self.assertFalse(is_dictionary_person({'subject_category':'일반어'}))
        unfiltered=await self.run_case('이수민',filter_people=False)
        self.assertTrue(unfiltered['annotations'] or unfiltered['targets'],unfiltered)
        filtered=await self.run_case('이수민',filter_people=True)
        self.assertEqual(filtered['annotations'],[])
        self.assertEqual(filtered['targets'],[])
        reviewed=await self.run_case('이수민',filter_people=True,review=True)
        self.assertEqual(reviewed['annotations'],[])
        self.assertEqual(reviewed['targets'],[])

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
        self.assertEqual(protected['targets'],[])
        self.assertGreater(protected['stats']['protected_names'],0)
        filtered=await self.run_case('이수민',filter_people=True,name_protection=True)
        self.assertEqual(filtered['annotations'],[])
        self.assertGreater(filtered['stats']['protected_names'],0)

if __name__=='__main__':
    unittest.main(verbosity=2)
