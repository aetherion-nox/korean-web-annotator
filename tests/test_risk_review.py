import unittest, types
import test_quantity_bonus as fixture
from backend.analysis import Engine
from backend.risk_review import weak_unique_candidate
from types import SimpleNamespace

class RiskReview(unittest.IsolatedAsyncioTestCase):
 asyncSetUp=fixture.Tests.asyncSetUp
 asyncTearDown=fixture.Tests.asyncTearDown
 add=fixture.Tests.add

 def with_tokens(self,items):
  t=fixture.tokenizer()
  t._kiwi=types.SimpleNamespace(tokenize=lambda _:[
    types.SimpleNamespace(form=form,tag=tag,start=offset,len=len(form))
    for form,tag,offset in items])
  return t

 async def run_text(self,text,items,*,risk=True,single=True,hanja=True,loanword=True):
  return await Engine(self.path,tokenizer=self.with_tokens(items)).analyze(
   text,dict(hanja=hanja,loanword=loanword,nameProtection=False,
             uniqueCandidateRiskReview=risk,singleHangulLocalGuard=single))

 async def test_known_full_mixed_word_converts_locally_even_when_split_and_single_guard_enabled(self):
  self.add('팀장','team長','명사','조직 팀의 책임자.')
  r=await self.run_text('팀장이',[('팀','NNG',0),('장','NNG',1),('이','JKS',2)])
  self.assertFalse(r['targets'],r)
  self.assertEqual(r['stats']['boundary_suspicions'],0,r)
  self.assertEqual([(a['surface'],a['replacement']) for a in r['annotations']],
                   [('팀','team'),('장','長')],r)
  self.assertEqual(r['confirmed_whole_spans'],[{'start':0,'end':2}],r)
  self.assertEqual(r['suffix_spans'],[{'start':2,'end':3}],r)

 async def test_unlisted_compound_is_protected_before_component_local_conversion(self):
  self.add('팀','team','명사','팀.')
  self.add('장','長','명사','우두머리.')
  r=await self.run_text('팀장이',[('팀','NNG',0),('장','NNG',1),('이','JKS',2)])
  self.assertFalse(r['annotations'],r)
  self.assertFalse(r['targets'],r)
  self.assertEqual(r['stats']['boundary_suspicions'],1,r)
  self.assertEqual(r['boundary_risks'][0]['surface'],'팀장',r)
  old=await self.run_text('팀장이',[('팀','NNG',0),('장','NNG',1),('이','JKS',2)],risk=False)
  # The explicit weak-unique heuristic may be off, but unconditional
  # word-boundary protection still forbids unsafe partial-word conversion.
  self.assertTrue(any(x['reason']=='unverified_word_boundary' for x in old['boundary_risks']),old)
  self.assertFalse(old['annotations'],old)

 async def test_weak_unique_homograph_is_sent_for_semantic_review(self):
  self.add('이상','以上','명사','정해진 수량을 넘음.')
  tokens=[('이상','NNG',0),('은','JX',2)]
  safe=await self.run_text('이상은',tokens,risk=True)
  self.assertEqual(safe['annotations'],[],safe)
  self.assertEqual(safe['stats']['unique_risk_reviews'],1,safe)
  self.assertEqual(len(safe['targets']),1,safe)
  target=safe['targets'][0]
  self.assertEqual(target['surface'],'이상')
  self.assertIn('weak_unique_dictionary_candidate',target['review_reasons'])
  self.assertTrue(any(o['replacement']=='以上' for o in target['options']))
  old=await self.run_text('이상은',tokens,risk=False)
  self.assertTrue(any(a['replacement']=='以上' for a in old['annotations']),old)

 async def test_strong_context_does_not_trigger_weak_unique_review(self):
  score=SimpleNamespace(original='이상',status='converted',start=0,end=2,
    candidates=[{'replacement':'以上','is_reliable':True,
      'score':0.80,'selection_reason':'collocation_match(조건->以上)'}])
  self.assertFalse(weak_unique_candidate(score,[]))
  score.candidates[0]['selection_reason']='reliable_replacement, pos_match, pure_hanja_type'
  score.candidates[0]['score']=0.55
  self.assertTrue(weak_unique_candidate(score,[]))

 async def test_high_scoring_single_spelling_without_context_is_still_a_risk(self):
  # A high scorer is not a semantic match. Different dictionary definitions
  # can share one written origin and still all be wrong in the sentence.
  candidate={'entry_id':465818,'replacement':'原蠶','is_reliable':True,
             'score':0.95,'selection_reason':'reliable_replacement, pos_match, pure_hanja_type'}
  score=SimpleNamespace(original='원잠',status='converted',start=3,end=5,
                        matched_entry_id=465818,candidates=[candidate])
  self.assertTrue(weak_unique_candidate(score,[]))
  score.candidates.append({**candidate,'entry_id':465819})
  # Two independent lexicon records keep the existing fast path; one record
  # can already hold multiple definitions and is still treated as one entry.
  self.assertFalse(weak_unique_candidate(score,[]))
  score.candidates[1]['replacement']='原潛'
  self.assertFalse(weak_unique_candidate(score,[]))
  score.candidates=score.candidates[:1]
  score.candidates[0]['selection_reason']='collocation_match(핵잠->原蠶)'
  self.assertFalse(weak_unique_candidate(score,[]))

 async def test_military_context_does_not_auto_apply_an_unrelated_agriculture_headword(self):
  # This fixture is intentionally the exact field failure; the production
  # rule above does not contain special cases for words or subject domains.
  self.add('원잠','原蠶','명사','원잠종을 받기 위하여 계통을 바르게 한 누에.')
  result=await self.run_text('핵잠(원잠)',[('핵잠','NNG',0),('원잠','NNG',3)])
  self.assertFalse(any(a['surface']=='원잠' for a in result['annotations']),result)
  review=next(t for t in result['targets'] if t['surface']=='원잠')
  self.assertIn('weak_unique_dictionary_candidate',review.get('review_reasons',[]))
  self.assertTrue(any(c['replacement']=='原蠶' for c in review['options']))
  self.assertEqual(result['stats']['unique_risk_reviews'],1,result)

 async def test_single_syllable_guard_off_restores_only_existing_rule(self):
  self.add('학','學','명사','공부.')
  r=await self.run_text('학',[('학','NNG',0)],risk=True,single=True)
  self.assertFalse(r['annotations'],r)
  r2=await self.run_text('학',[('학','NNG',0)],risk=True,single=False)
  self.assertTrue(any(a['replacement']=='學' for a in r2['annotations']),r2)

if __name__=='__main__':unittest.main(verbosity=2)
