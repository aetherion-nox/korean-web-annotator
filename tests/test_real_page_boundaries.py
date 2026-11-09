import unittest, types
import test_quantity_bonus as fixture
from backend.analysis import Engine
from backend.risk_review import unverified_word_boundary

class RealPageBoundarySafety(unittest.IsolatedAsyncioTestCase):
 asyncSetUp=fixture.Tests.asyncSetUp
 asyncTearDown=fixture.Tests.asyncTearDown
 add=fixture.Tests.add

 def tokens(self,items):
  tok=fixture.tokenizer()
  tok._kiwi=types.SimpleNamespace(tokenize=lambda _:[
   types.SimpleNamespace(form=form,tag=tag,start=start,len=len(form)) for form,tag,start in items])
  return tok

 async def analyze(self,text,items):
  return await Engine(self.path,tokenizer=self.tokens(items)).analyze(text,{
   'hanja':True,'loanword':True,'nameProtection':False,
   'singleHangulLocalGuard':True,'uniqueCandidateRiskReview':True})

 async def test_wenjin_street_never_borrows_song_hanja(self):
  self.add('문진가','問津歌','명사','조선 중종 때 주세붕이 지은 단가.')
  r=await self.analyze('문진가두 선거구',[('문진가','NNG',0),('두','NNG',3),
         ('선거구','NNG',6)])
  self.assertFalse(any(a['replacement']=='問津歌' for a in r['annotations']),r)
  self.assertTrue(any(t['surface']=='문진가두' for t in r['boundary_risks']),r)

 async def test_jaguanggak_determiner_cannot_replace_building_name_character(self):
  self.add('각','各','관형사','낱낱의 모든.')
  r=await self.analyze('자광각 투표소',[('자광','NNG',0),('각','MM',2),
                                        ('투표소','NNG',4)])
  self.assertFalse(any(a['replacement']=='各' for a in r['annotations']),r)
  self.assertTrue(any(t['surface']=='자광각' for t in r['boundary_risks']),r)
  self.assertTrue(any(t.get('boundary_unverified') for t in r['targets']),r)

 async def test_chamdapge_cannot_take_decapitation_origin(self):
  self.add('참','斬','명사','목을 벰.')
  r=await self.analyze('참답게 작성',[('참','NNG',0),('답','XSA',1),
                                      ('게','EC',2),('작성','NNG',4)])
  self.assertFalse(any(a['replacement']=='斬' for a in r['annotations']),r)
  self.assertTrue(any(t['surface']=='참답게' for t in r['boundary_risks']),r)

 async def test_legitimate_hanja_plus_particle_still_passes(self):
  self.add('학교','學校','명사','공부하는 곳.')
  r=await self.analyze('학교를',[('학교','NNG',0),('를','JKO',2)])
  self.assertTrue(any(a['replacement']=='學校' for a in r['annotations']),r)
  self.assertFalse(any(t['reason']=='unverified_word_boundary' for t in r['boundary_risks']),r)

 async def test_known_whole_mixed_word_still_passes(self):
  self.add('팀장','team長','명사','팀의 책임자.')
  r=await self.analyze('팀장이',[('팀','NNG',0),('장','NNG',1),('이','JKS',2)])
  self.assertEqual([(a['surface'],a['replacement']) for a in r['annotations']],
                   [('팀','team'),('장','長')],r)

 async def test_fallback_synthetic_loanword_candidates_not_sent(self):
  self.add('북경시','北京市','명사','중국 수도의 시.')
  self.add('시','C','명사','음악의 음이름.')
  r=await self.analyze('북경시',[('북경시','NNG',0)])
  for t in r['targets']:
   self.assertFalse(any('북경C'==o.get('replacement') for o in t['options']),r)

if __name__=='__main__': unittest.main(verbosity=2)
