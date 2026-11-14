import types
import unittest
from test_quantity_bonus import Tests,tokenizer
from backend.analysis import Engine

class SmartSegmentationContext(unittest.IsolatedAsyncioTestCase):
    asyncSetUp=Tests.asyncSetUp
    asyncTearDown=Tests.asyncTearDown
    add=Tests.add

    def fixed(self,word,tag):
        service=tokenizer()
        service._kiwi=types.SimpleNamespace(tokenize=lambda _: [
            types.SimpleNamespace(form=word,tag=tag,start=0,len=len(word))])
        return service

    async def test_kiwi_tokens_are_shared_only_for_enabled_repair_mode(self):
        text='학교'
        engine=Engine(self.path,tokenizer=self.fixed(text,'NNG'))
        base=await engine.analyze(text,dict(hanja=True,loanword=False,nameProtection=True))
        self.assertNotIn('repair_context',base)
        enabled=await engine.analyze(text,dict(hanja=True,loanword=False,
            nameProtection=True,smartSegmentation=True))
        info=enabled['repair_context']
        self.assertEqual(info['kiwi_tokens'],[dict(form=text,tag='NNG',start=0,end=2)])
        self.assertEqual(info['protected_ranges'],[])
        self.assertTrue(all('partial_word' not in target for target in enabled['targets']))

    async def test_proper_noun_is_guarded_even_with_no_dictionary_target(self):
        text='이수민'
        engine=Engine(self.path,tokenizer=self.fixed(text,'NNP'))
        value=await engine.analyze(text,dict(hanja=True,loanword=True,
            nameProtection=True,filterDictionaryPeople=True,smartSegmentation=True))
        self.assertIn([0,3],value['repair_context']['protected_ranges'])
        self.assertEqual(value['repair_context']['kiwi_tokens'][0]['tag'],'NNP')

    async def test_no_extra_lookup_or_retokenization_needed_for_repair_context(self):
        text='사무실'
        calls=[]
        class RecordingEngine(Engine):
            async def tokens(self,text):
                calls.append(text)
                return await super().tokens(text)
        engine=RecordingEngine(self.path,tokenizer=self.fixed(text,'NNG'))
        await engine.analyze(text,dict(hanja=True,loanword=True,
            nameProtection=True,smartSegmentation=True,reviewLocalConversions=True))
        self.assertEqual(calls,[text])

if __name__=='__main__':
    unittest.main(verbosity=2)
