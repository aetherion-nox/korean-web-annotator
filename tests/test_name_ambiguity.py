import unittest,sqlite3,types
from test_quantity_bonus import Tests,tokenizer
from backend.analysis import Engine
class NameAmbiguity(unittest.IsolatedAsyncioTestCase):
 asyncSetUp=Tests.asyncSetUp
 asyncTearDown=Tests.asyncTearDown
 add=Tests.add
 async def test_same_spelling_name_and_ordinary_requires_model_and_bypasses_local(self):
  ordinary=self.add('이상','理想','명사','바라는 상태.')
  person=self.add('이상','李箱','고유 명사','유명한 시인.')
  with sqlite3.connect(self.path) as db:db.execute("UPDATE entries SET subject_category='인명' WHERE id=?",(person,))
  t=tokenizer();t._kiwi=types.SimpleNamespace(tokenize=lambda _:[types.SimpleNamespace(form='이상',tag='NNG',start=0,len=2),types.SimpleNamespace(form='은',tag='JX',start=2,len=1)])
  r=await Engine(self.path,tokenizer=t).analyze('이상은',dict(hanja=True,loanword=True,nameProtection=True))
  self.assertEqual(r['annotations'],[])
  self.assertEqual(len(r['targets']),1)
  x=r['targets'][0];self.assertTrue(x['dictionary_name_homograph']);self.assertEqual({o.get('entry_id') for o in x['options'] if o['type']!='keep'},{ordinary,person})
 async def test_complete_ordinary_word_with_split_surname_goes_to_review(self):
  common=self.add('남상원','南上院','명사','가상의 일반 단어.')
  t=tokenizer();t._kiwi=types.SimpleNamespace(tokenize=lambda _:[types.SimpleNamespace(form='남',tag='NNP',start=0,len=1),types.SimpleNamespace(form='상원',tag='NNG',start=1,len=2),types.SimpleNamespace(form='이',tag='JKS',start=3,len=1)])
  r=await Engine(self.path,tokenizer=t).analyze('남상원이',dict(hanja=True,loanword=True,nameProtection=True))
  self.assertEqual(r['annotations'],[]);self.assertEqual(len(r['targets']),1)
  self.assertTrue(r['targets'][0]['suspected_person_name']);self.assertEqual(r['targets'][0]['surface'],'남상원')
 async def test_normal_ordinary_word_does_not_trigger_surname_review(self):
  self.add('김치','沈菜','명사','절인 채소.')
  t=tokenizer();t._kiwi=types.SimpleNamespace(tokenize=lambda _:[types.SimpleNamespace(form='김치',tag='NNG',start=0,len=2),types.SimpleNamespace(form='가',tag='JKS',start=2,len=1)])
  r=await Engine(self.path,tokenizer=t).analyze('김치가',dict(hanja=True,loanword=True,nameProtection=True))
  self.assertFalse(any(t.get('suspected_person_name') for t in r['targets']))
if __name__=='__main__':unittest.main(verbosity=2)
