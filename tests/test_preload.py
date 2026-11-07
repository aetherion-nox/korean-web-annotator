import unittest,sys,json
from pathlib import Path
from unittest.mock import patch
import test_quantity_bonus as fixture
sys.path.insert(0,str(fixture.ROOT/'python/browser-support'))
import browser_bridge as bridge
class Tests(unittest.IsolatedAsyncioTestCase):
 asyncSetUp=fixture.Tests.asyncSetUp
 asyncTearDown=fixture.Tests.asyncTearDown
 add=fixture.Tests.add
 async def test_preload_initializes_real_engine_without_analyzing_or_changing_output(self):
  bridge._engine=None
  with patch('backend.analysis.TokenizerService',return_value=fixture.tokenizer()), patch('backend.analysis.Engine.analyze',side_effect=AssertionError('preload must not annotate')):
   response=json.loads(await bridge.request({'action':'warmup','db_path':str(self.path)}))
   self.assertTrue(response['ready']);self.assertTrue(bridge._engine._ready);original=bridge._engine
   again=json.loads(await bridge.request({'action':'warmup','db_path':str(self.path)}))
   self.assertEqual(response,again);self.assertIs(original,bridge._engine)
  expected=await fixture.Engine(self.path,tokenizer=fixture.tokenizer()).analyze('2주',dict(hanja=True,loanword=True))
  actual=await bridge.analyze('2주',dict(hanja=True,loanword=True),self.path)
  self.assertEqual(actual,expected)
if __name__=='__main__':unittest.main(verbosity=2)
