import unittest, types
import test_quantity_bonus as fixture
from backend.analysis import Engine

class SingleHangulGuard(unittest.IsolatedAsyncioTestCase):
 asyncSetUp=fixture.Tests.asyncSetUp
 asyncTearDown=fixture.Tests.asyncTearDown
 add=fixture.Tests.add

 def tokenizer_for(self,forms):
  tokenizer=fixture.tokenizer()
  tokenizer._kiwi=types.SimpleNamespace(tokenize=lambda _:
   [types.SimpleNamespace(form=form,tag=tag,start=start,len=len(form))
    for form,tag,start in forms])
  return tokenizer

 async def analyze(self,text,forms,guard=True,*,hanja=True,loanword=False):
  return await Engine(self.path,tokenizer=self.tokenizer_for(forms)).analyze(text,{
   'hanja':hanja,'loanword':loanword,'nameProtection':False,
   'singleHangulLocalGuard':guard
  })

 async def test_single_hanja_is_reviewed_not_directly_converted(self):
  self.add('학','學','명사','배우는 학문.')
  on=await self.analyze('학',[('학','NNG',0)],True)
  off=await self.analyze('학',[('학','NNG',0)],False)
  self.assertFalse(on['annotations'],on)
  self.assertTrue(on['targets'],on)
  self.assertTrue(any(o.get('replacement')=='學' for t in on['targets'] for o in t['options']))
  self.assertTrue(any(a['replacement']=='學' for a in off['annotations']),off)

 async def test_longer_hanja_word_still_locally_converts(self):
  r=await self.analyze('학교',[('학교','NNG',0)],True)
  self.assertTrue(any(a['surface']=='학교' and a['replacement']=='學校' for a in r['annotations']),r)

 async def test_single_loanword_uses_review_instead_of_local_conversion(self):
  self.add('빵','pain','명사','구운 음식.')
  on=await self.analyze('빵',[('빵','NNG',0)],True,hanja=False,loanword=True)
  off=await self.analyze('빵',[('빵','NNG',0)],False,hanja=False,loanword=True)
  self.assertFalse(on['annotations'],on)
  self.assertTrue(any(o.get('replacement')=='pain' for t in on['targets'] for o in t['options']),on)
  self.assertTrue(any(a['replacement']=='pain' for a in off['annotations']),off)

 async def test_complete_mixed_entry_with_internal_single_hanja_is_not_blocked(self):
  self.add('김게임','金game','명사','가상의 혼종어.')
  on=await self.analyze('김게임',[('김게임','NNG',0)],True,hanja=True,loanword=True)
  off=await self.analyze('김게임',[('김게임','NNG',0)],False,hanja=True,loanword=True)
  self.assertTrue(any(a['surface']=='김' and a['replacement']=='金' for a in on['annotations']),on)
  self.assertTrue(any(a['surface']=='게임' and a['replacement']=='game' for a in on['annotations']),on)
  self.assertEqual(on['annotations'],off['annotations'],(on,off))

if __name__=='__main__':unittest.main(verbosity=2)
