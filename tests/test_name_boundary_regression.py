import asyncio,sys,types,unittest
from pathlib import Path
ROOT=Path(sys.argv[1] if len(sys.argv)>1 else str(Path(__file__).resolve().parents[1])).resolve()
sys.argv=sys.argv[:1]
sys.path[:0]=[str(ROOT/'python'),str(ROOT/'python/backend/upstream')]
from backend.proper_nouns import surname_name_evidence,dictionary_name_evidence

def token(form,start,tag='NNG'):
 return types.SimpleNamespace(form=form,start=start,length=len(form),tag=tag)

class NameBoundaryRegression(unittest.IsolatedAsyncioTestCase):
 async def test_common_compounds_beginning_with_surname_syllables_are_not_persons(self):
  for text,parts in [
   ('전자기기',['전자','기기']),
   ('공공기관',['공공','기관']),
   ('서류작업',['서류','작업']),
   ('서민복지',['서민','복지']),
   ('부정선거',['부정','선거'])
  ]:
   with self.subTest(text=text):
    tokens=[];start=0
    for part in parts:
     tokens.append(token(part,start));start+=len(part)
    async def lookup(forms):
     # A 1-character surname is present. The full compound is an
     # ordinary convertible dictionary word, not a personal name.
     return {form:(
      [dict(surname_usage=True,entry_id=8,origin_raw='金',
            part_of_speech='명사')] if len(form)==1 else
      [dict(entry_id=9,origin_raw='公共機關',part_of_speech='명사')]
      if form==text else []
     ) for form in forms}
    names,ambiguous=await surname_name_evidence(text,tokens,lookup)
    self.assertEqual((names,ambiguous),([],[]),text)

 async def test_split_surname_and_person_name_remain_protected(self):
  text='이수민';tokens=[token('이',0),token('수민',1),token('이',3,'JKS')]
  async def lookup(forms):
   return {form:(
    [dict(surname_usage=True,entry_id=8,origin_raw='李',
          part_of_speech='명사')] if form=='이' else
    [dict(entry_id=9,origin_raw='李壽民',part_of_speech='명사')]
    if form==text else []
   ) for form in forms}
  names,ambiguous=await surname_name_evidence(text,tokens,lookup)
  self.assertEqual(names,[])
  self.assertEqual([x[2] for x in ambiguous],[text])

 async def test_unrelated_person_homograph_does_not_label_common_noun_or_determiner(self):
  async def lookup(forms):
   return {form:[
    dict(entry_id=1,origin_raw='文帝',part_of_speech='명사',
         subject_category='인명'),
    dict(entry_id=2,origin_raw='問題',part_of_speech='명사')
   ] for form in forms}
  for tag in ('NNG','MM'):
   names,conflicts,verified=await dictionary_name_evidence(
    '문제',[token('문제',0,tag)],lookup,
    include_person_hanja=True,spans=[(0,2,'문제')])
   self.assertEqual(names,[],tag)
   self.assertEqual(conflicts,[],tag)
  names,conflicts,verified=await dictionary_name_evidence(
   '문제',[token('문제',0,'NNP')],lookup,
   include_person_hanja=True,spans=[(0,2,'문제')])
  self.assertEqual(names,[(0,2)])
  self.assertEqual(conflicts[0][2],'문제')

 async def test_dictionary_only_person_still_stays_protected(self):
  async def lookup(forms):
   return {form:[dict(entry_id=1,origin_raw='李壽民',
     part_of_speech='명사',subject_category='인명')] for form in forms}
  names,_,_=await dictionary_name_evidence(
   '이수민',[token('이수민',0)],lookup,
   include_person_hanja=True,spans=[(0,3,'이수민')])
  self.assertEqual(names,[(0,3)])

if __name__=='__main__':unittest.main(verbosity=2)
