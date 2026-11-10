import types
import unittest
from test_quantity_bonus import Tests, tokenizer
from backend.analysis import Engine

class SelectiveReview(unittest.IsolatedAsyncioTestCase):
    asyncSetUp=Tests.asyncSetUp
    asyncTearDown=Tests.asyncTearDown
    add=Tests.add

    def fixed_tokenizer(self,word,tag='NNG'):
        t=tokenizer()
        t._kiwi=types.SimpleNamespace(tokenize=lambda _: [
            types.SimpleNamespace(form=word,tag=tag,start=0,len=len(word))
        ])
        return t

    async def test_positive_hanja_is_held_for_model_with_same_original_span(self):
        word='사무실'  # already in the fixture as 事務室
        token=self.fixed_tokenizer(word)
        old=await Engine(self.path,tokenizer=token).analyze(word,dict(hanja=True,loanword=False,nameProtection=False))
        audited=await Engine(self.path,tokenizer=token).analyze(word,dict(hanja=True,loanword=False,nameProtection=False,reviewLocalConversions=True))
        self.assertTrue(any(a['replacement']=='事務室' for a in old['annotations']),old)
        self.assertEqual(audited['annotations'],[])
        self.assertTrue(any(t['surface']==word for t in audited['targets']),audited)
        target=next(t for t in audited['targets'] if t['surface']==word)
        self.assertEqual((target['start'],target['end']),(0,len(word)))
        self.assertIn('KEEP',[o['choice_id'] for o in target['options']])
        self.assertIn('事務室',[o['replacement'] for o in target['options'] if o['type']=='hanja'])

    async def test_original_native_nonconversion_is_not_promoted_into_a_target(self):
        word='토박이'
        self.add(word,None,'명사','그곳에 원래부터 살던 사람.')
        token=self.fixed_tokenizer(word)
        audited=await Engine(self.path,tokenizer=token).analyze(word,dict(hanja=True,loanword=False,nameProtection=False,reviewLocalConversions=True))
        self.assertEqual(audited['annotations'],[])
        self.assertEqual(audited['targets'],[])

    async def test_loanword_conversion_is_routed_for_review(self):
        word='게임'
        self.add(word,'game','명사','게임을 하는 일.')
        token=self.fixed_tokenizer(word)
        base=await Engine(self.path,tokenizer=token).analyze(word,dict(hanja=False,loanword=True,nameProtection=False))
        audited=await Engine(self.path,tokenizer=token).analyze(word,dict(hanja=False,loanword=True,nameProtection=False,reviewLocalConversions=True))
        self.assertTrue(any(a['type']=='loanword' for a in base['annotations']),base)
        self.assertEqual(audited['annotations'],[])
        self.assertTrue(any(o['type']=='loanword' for t in audited['targets'] for o in t['options']),audited)

if __name__=='__main__':
    unittest.main(verbosity=2)
