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
 async def test_dictionary_proven_person_is_reviewed_even_if_nng_or_split(self):
  for split in [False,True]:
   for review in [False,True]:
    r=await self.run_name(split=split,review=review)
    self.assertEqual(r['annotations'],[])
    self.assertEqual(len(r['targets']),1,(split,review,r))
    person=r['targets'][0]
    self.assertEqual(person['surface'],'이수민')
    self.assertEqual(person['verified_person_hanja'],['李壽民'])
    self.assertTrue(person['dictionary_person_name'])
    self.assertTrue(any(o['type']=='hanja' and o['entry_id']==self.person and
                        o['replacement']=='李壽民' for o in person['options']))
    self.assertGreater(r['stats']['protected_names'],0)

 async def test_filtered_dictionary_person_removes_verified_hanja_candidate(self):
  from backend.analysis import Engine
  t=self.tokenized('이수민 씨')
  r=await Engine(self.path,tokenizer=t).analyze('이수민 씨',dict(
      hanja=True,loanword=True,nameProtection=True,filterDictionaryPeople=True,
      experimentalHanjaAudit=True))
  person=[x for x in r['targets'] if x['surface']=='이수민']
  self.assertEqual(person,[],r)
  self.assertEqual(r['annotations'],[],r)
  unfiltered=await Engine(self.path,tokenizer=t).analyze('이수민 씨',dict(
      hanja=True,loanword=True,nameProtection=True,filterDictionaryPeople=False,
      experimentalHanjaAudit=True))
  self.assertEqual(unfiltered['targets'][0]['verified_person_hanja'],['李壽民'])

 async def test_person_without_verified_hanja_remains_filtered_or_keep_only(self):
  from backend.analysis import Engine
  import sqlite3
  record=self.add('한동훈',None,'명사','현직 정치인.')
  with sqlite3.connect(self.path) as db:
   db.execute("UPDATE entries SET subject_category='인명' WHERE id=?",(record,))
  t=tokenizer();t._kiwi=types.SimpleNamespace(tokenize=lambda _:[
      types.SimpleNamespace(form='한동훈',tag='NNP',start=0,len=3)])
  r=await Engine(self.path,tokenizer=t).analyze('한동훈',dict(
      hanja=True,loanword=True,nameProtection=True,filterDictionaryPeople=True,
      experimentalLoanwordAudit=True))
  matches=[x for x in r['targets'] if x['surface']=='한동훈']
  self.assertEqual(len(matches),1)
  self.assertTrue(matches[0]['dictionary_person_name'])
  self.assertNotIn('verified_person_hanja',matches[0])
  self.assertEqual([x['type'] for x in matches[0]['options']],['keep'])
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

 async def test_experimental_latin_audits_full_proper_nouns_without_automatic_name_conversion(self):
  from backend.analysis import Engine
  for word in ('트럼프','트위터','엔비디아'):
   t=tokenizer()
   t._kiwi=types.SimpleNamespace(tokenize=lambda _,w=word:[
    types.SimpleNamespace(form=w,tag='NNP',start=0,len=len(w)),
    types.SimpleNamespace(form='는',tag='JX',start=len(w),len=1)])
   source=word+'는'
   modes=dict(hanja=True,loanword=True,nameProtection=True,filterDictionaryPeople=True)
   ordinary=await Engine(self.path,tokenizer=t).analyze(source,modes)
   self.assertFalse(any(x.get('experimental_loanword_audit') for x in ordinary['targets']))
   audit=await Engine(self.path,tokenizer=t).analyze(source,{**modes,'experimentalLoanwordAudit':True})
   targets=[x for x in audit['targets'] if x.get('experimental_loanword_audit')]
   self.assertEqual(len(targets),1,(word,audit))
   self.assertEqual((targets[0]['start'],targets[0]['end'],targets[0]['surface']),
                    (0,len(word),word))
   self.assertEqual([o['type'] for o in targets[0]['options']],['keep'])
   self.assertFalse(any(a['surface']==word for a in audit['annotations']))
  # An explicit space remains a hard target boundary, including NNP spans.
  t=tokenizer()
  t._kiwi=types.SimpleNamespace(tokenize=lambda _:[
   types.SimpleNamespace(form='젠슨 황',tag='NNP',start=0,len=4)])
  result=await Engine(self.path,tokenizer=t).analyze('젠슨 황',{
   'hanja':True,'loanword':True,'experimentalLoanwordAudit':True})
  self.assertFalse(any(x.get('experimental_loanword_audit') for x in result['targets']))

if __name__=='__main__':unittest.main(verbosity=2)
