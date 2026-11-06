import unittest,sys,types
import test_quantity_bonus as fixture
ROOT=fixture.ROOT
tokenizer=fixture.tokenizer

class DictionaryNames(unittest.IsolatedAsyncioTestCase):
 asyncSetUp=fixture.Tests.asyncSetUp
 asyncTearDown=fixture.Tests.asyncTearDown
 add=fixture.Tests.add
 async def asyncSetUp(self):
  await fixture.Tests.asyncSetUp(self)
  self.person=self.add('이수민','李壽民','명사','조선 후기의 무신(1651~1724).')
  import sqlite3
  with sqlite3.connect(self.path) as db:db.execute("UPDATE entries SET subject_category='인명' WHERE id=?",(self.person,))
 def tokenized(self,text,split=False):
  t=tokenizer()
  forms=[('이','NNG',0,1),('수민','NNG',1,2)] if split else [('이수민','NNG',0,3)]
  t._kiwi=types.SimpleNamespace(tokenize=lambda _: [types.SimpleNamespace(form=f,tag=tag,start=a,len=n) for f,tag,a,n in forms])
  return t
 async def run_name(self,on=True,split=False,review=False):
  from backend.analysis import Engine
  return await Engine(self.path,tokenizer=self.tokenized('이수민 씨',split)).analyze('이수민 씨',dict(hanja=True,loanword=True,nameProtection=on,reviewAll=review))
 async def test_dictionary_person_is_preserved_even_if_nng_and_unique(self):
  for split in [False,True]:
   for review in [False,True]:
    r=await self.run_name(split=split,review=review)
    self.assertEqual(r['annotations'],[])
    self.assertEqual(r['targets'],[])
    self.assertGreater(r['stats']['protected_names'],0)
 async def test_disabled_protection_forces_identity_review(self):
  r=await self.run_name(on=False,split=True)
  self.assertEqual(r['annotations'],[])
  self.assertEqual(len(r['targets']),1)
  t=r['targets'][0]
  self.assertTrue(t['dictionary_person_name'])
  self.assertTrue(t['proper_noun'])
  self.assertTrue(any(o['entry_id']==self.person and o['subject_category']=='인명' for o in t['options']))
 async def test_unrelated_ordinary_noun_still_local(self):
  from backend.analysis import Engine
  t=self.tokenized('학교');t._kiwi=types.SimpleNamespace(tokenize=lambda _: [types.SimpleNamespace(form='학교',tag='NNG',start=0,len=2)])
  r=await Engine(self.path,tokenizer=t).analyze('학교',dict(hanja=True,loanword=True))
  self.assertEqual(r['annotations'][0]['replacement'],'學校')

 async def test_classification_rule_also_covers_loanword_and_mixed_names(self):
  from backend.analysis import Engine
  import sqlite3
  for word,origin in [('마이클','Michael'),('김게임','金game')]:
   key=self.add(word,origin,'명사','A dictionary person.')
   with sqlite3.connect(self.path) as db:db.execute("UPDATE entries SET subject_category='人名' WHERE id=?",(key,))
   for enabled in [True,False]:
    t=self.tokenized(word);t._kiwi=types.SimpleNamespace(tokenize=lambda _,w=word:[types.SimpleNamespace(form=w,tag='NNG',start=0,len=len(w))])
    r=await Engine(self.path,tokenizer=t).analyze(word,dict(hanja=True,loanword=True,nameProtection=enabled))
    self.assertEqual(r['annotations'],[],(word,enabled,r))
    self.assertEqual(bool(r['targets']),not enabled,(word,enabled,r))
    if not enabled:self.assertTrue(r['targets'][0]['dictionary_person_name'])

if __name__=='__main__':unittest.main(verbosity=2)
