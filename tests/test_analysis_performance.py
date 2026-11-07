"""Guard duplicate tokenization and quadratic UTF-16 encoding without changing choices."""
import asyncio,re,sys,types,unittest
from pathlib import Path
from unittest.mock import patch
ROOT=Path(sys.argv[1] if len(sys.argv)>1 else str(Path(__file__).resolve().parents[1])).resolve();sys.argv=sys.argv[:1]
sys.path[:0]=[str(ROOT/'python'),str(ROOT/'python/backend/upstream')]
bootstrap=types.ModuleType('backend.bootstrap');bootstrap.ensure_environment=lambda:None;sys.modules['backend.bootstrap']=bootstrap
from app.services.tokenizer import TokenizerService
from backend.analysis import Engine
from backend.offsets import to_utf16
class Tests(unittest.IsolatedAsyncioTestCase):
 async def analyze(self):
  self.text='😀 '+' '.join(['학교']*30);self.calls=0
  def tokenize(text):
   self.calls+=1
   return [types.SimpleNamespace(form='학교',tag='NNG',start=m.start(),len=2) for m in re.finditer('학교',text)]
  tokenizer=TokenizerService.__new__(TokenizerService);tokenizer._available=True;tokenizer._tokenize_lock=asyncio.Semaphore(1);tokenizer._kiwi=types.SimpleNamespace(tokenize=tokenize)
  async def lookup(forms):
   return {f:([dict(entry_id=i,written_form=f,origin_raw=h,replacement=h,replacement_type='pure_hanja',is_reliable=1,part_of_speech='명사') for i,h in [(1,'學校'),(2,'學敎')]] if f=='학교' else []) for f in forms}
  return await Engine(tokenizer=tokenizer,lookup_fn=lookup,fingerprint='fixture').analyze(self.text,dict(hanja=True,nameProtection=False))
 async def test_one_tokenization_per_analysis(self):
  result=await self.analyze();self.assertEqual(self.calls,1);self.assertEqual(len(result['targets']),30)
 async def test_offsets_are_encoded_linearly_and_keep_astral_positions(self):
  with patch('backend.analysis.to_utf16',wraps=to_utf16) as encode:
   result=await self.analyze()
  self.assertLessEqual(encode.call_count,30*10)
  self.assertEqual([t['start'] for t in result['targets']],list(range(3,93,3)))
  self.assertEqual([t['surface'] for t in result['targets']],['학교']*30)
  self.assertTrue(all(len(t['options'])==3 for t in result['targets']))
if __name__=='__main__':unittest.main(verbosity=2)
