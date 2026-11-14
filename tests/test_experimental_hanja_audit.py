import types
import unittest
from test_quantity_bonus import Tests, tokenizer
from backend.analysis import Engine


def with_tokens(parts):
    service=tokenizer()
    service._kiwi=types.SimpleNamespace(tokenize=lambda _:[
        types.SimpleNamespace(form=word,tag=tag,start=start,len=len(word))
        for word,tag,start in parts])
    return service


class ExperimentalHanjaAudit(unittest.IsolatedAsyncioTestCase):
    asyncSetUp=Tests.asyncSetUp
    asyncTearDown=Tests.asyncTearDown
    add=Tests.add

    async def analyze(self,text,parts,*,audit=True,loanword=False,smart=False):
        engine=Engine(self.path,tokenizer=with_tokens(parts))
        return await engine.analyze(text,dict(hanja=True,loanword=loanword,
            nameProtection=True,filterDictionaryPeople=True,
            experimentalHanjaAudit=audit,smartSegmentation=smart))

    async def test_unknown_hanja_noun_has_target_without_segmentation_repair(self):
        result=await self.analyze('원잠',[('원잠','NNG',0)])
        matches=[t for t in result['targets'] if t['surface']=='원잠']
        self.assertEqual(len(matches),1)
        self.assertTrue(matches[0]['experimental_hanja_audit'])
        self.assertEqual([o['type'] for o in matches[0]['options']],['keep'])
        self.assertNotIn('repair_context',result)

    async def test_disabled_mode_does_not_generate_audit_targets(self):
        result=await self.analyze('원잠',[('원잠','NNG',0)],audit=False)
        self.assertFalse(any(t.get('experimental_hanja_audit') for t in result['targets']))

    async def test_known_native_entry_is_never_hanja_audited(self):
        self.add('사람',None,'명사','인간을 뜻하는 고유어.')
        result=await self.analyze('사람',[('사람','NNG',0)])
        self.assertFalse(any(t.get('experimental_hanja_audit') for t in result['targets']))

    async def test_unknown_non_person_proper_noun_can_be_reviewed(self):
        result=await self.analyze('삼성',[('삼성','NNP',0)])
        self.assertTrue(any(t['surface']=='삼성' and t.get('experimental_hanja_audit')
                            for t in result['targets']))

    async def test_surname_guard_blocks_an_unrecognized_person_name(self):
        result=await self.analyze('김민수',[('김민수','NNP',0)])
        self.assertFalse(any(t.get('experimental_hanja_audit') for t in result['targets']))

    async def test_local_dictionary_conversion_does_not_gain_duplicate_target(self):
        result=await self.analyze('학교',[('학교','NNG',0)])
        self.assertFalse(any(t.get('experimental_hanja_audit') for t in result['targets']))

    async def test_unknown_compound_component_has_precise_span(self):
        result=await self.analyze('경제정책',[('경제','NNG',0),('정책','NNG',2)])
        flagged=[t for t in result['targets'] if t.get('experimental_hanja_audit')]
        self.assertTrue(any(t['surface']=='정책' and (t['start'],t['end'])==(2,4)
                            for t in flagged))

    async def test_loanword_audit_remains_independent(self):
        result=await self.analyze('원잠',[('원잠','NNG',0)],loanword=True)
        self.assertEqual(len([t for t in result['targets'] if t.get('experimental_hanja_audit')]),1)


if __name__=='__main__':
    unittest.main(verbosity=2)
