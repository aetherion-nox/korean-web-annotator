"""Guard duplicate tokenization and quadratic UTF-16 encoding without changing choices."""
import asyncio,re,sys,types,unittest
from pathlib import Path
from unittest.mock import patch
ROOT=Path(sys.argv[1] if len(sys.argv)>1 else str(Path(__file__).resolve().parents[1])).resolve();sys.argv=sys.argv[:1]
sys.path[:0]=[str(ROOT/'python'),str(ROOT/'python/backend/upstream')]
bootstrap=types.ModuleType('backend.bootstrap');bootstrap.ensure_environment=lambda:None;sys.modules['backend.bootstrap']=bootstrap
from app.services.tokenizer import TokenizerService
from backend.analysis import Engine
from backend.offsets import to_utf16, _supplementary_positions
from backend.mixed_origins import collect_mixed
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
 async def test_utf16_long_document_matches_original_encoding_and_caches_source(self):
  # A 17K+ source with supplementary glyphs and a lone surrogate exercises
  # the exact UTF-16 positions without repeatedly encoding long prefixes.
  text='😀 '+'대한민국헌법'*2500+'💯'+'가'*2300+'\\ud800'
  _supplementary_positions.cache_clear()
  for i in list(range(0,len(text)+1,137))+[0,1,2,len(text)-1,len(text)]:
   with self.subTest(i=i):
    self.assertEqual(to_utf16(text,i),
      len(text[:i].encode('utf-16-le',errors='surrogatepass'))//2)
  info=_supplementary_positions.cache_info()
  self.assertEqual(info.misses,1)
  self.assertGreater(info.hits,30)
  with self.assertRaises(ValueError):to_utf16(text,-1)
  with self.assertRaises(ValueError):to_utf16(text,len(text)+1)

 async def test_long_mixed_candidate_scanning_is_local_not_global(self):
  # A large run of independent legal-document terms creates many spans.
  # Each span should inspect only its nearby Kiwi tokens, not all tokens.
  counter=[0]
  class Token:
   tag='NNG'
   length=2
   form='학교'
   def __init__(self,start):self._start=start
   @property
   def start(self):counter[0]+=1;return self._start
  n=1400
  tokens=[Token(i*3) for i in range(n)]
  text='학교 '*n
  class Engine:
   async def lookup_entries(self,forms,*,filter_people=False):
    return {form:[] for form in forms}
  result=await collect_mixed(Engine(),text,tokens,{},blocked_ranges=(),review_ranges=())
  self.assertEqual(result['annotations'],[])
  self.assertEqual(result['targets'],[])
  self.assertLess(counter[0],n*35,
                  'candidate token lookup should not be quadratic')

 async def test_large_whole_word_range_index_avoids_per_candidate_scans(self):
  class CountedRanges(list):
   visits=0
   def __iter__(self):
    self.visits+=1
    return super().__iter__()
  n=1400
  text='학교 '*n
  tokens=[types.SimpleNamespace(start=3*i,length=2,form='학교',tag='NNG') for i in range(n)]
  whole=CountedRanges((3*i,3*i+2) for i in range(n))
  class EmptyDictionary:
   async def lookup_entries(self,forms,*,filter_people=False):
    return {form:[] for form in forms}
  result=await collect_mixed(EmptyDictionary(),text,tokens,dict(hanja=True),
                             whole_word_ranges=whole)
  self.assertEqual(result['annotations'],[])
  self.assertEqual(result['targets'],[])
  self.assertLessEqual(whole.visits,3,'indexed ranges must not be rescanned per word')

 async def test_local_token_span_index_keeps_review_options_identical(self):
  result=await self.analyze()
  self.assertEqual(len(result['targets']),30)
  self.assertTrue(all(t['morphology'] and t['morphology'][0]['form']=='학교'
                      for t in result['targets']))
  self.assertTrue(all(sorted(o['replacement'] for o in t['options'] if o['type']=='hanja')
                      == ['學敎','學校'] for t in result['targets']))

 async def test_repeated_legal_terms_cache_dictionary_lookups_without_changing_options(self):
  counters={'candidates':0,'entries':0,'definitions':0,'metadata':0,'connection':0}
  async def lookup(forms):
   counters['candidates']+=1
   return {f:[dict(entry_id=42,written_form=f,origin_raw='法律',replacement='法律',
                   part_of_speech='명사')] for f in forms}
  class Conn:
   async def close(self):pass
  class Dictionary:
   async def get_connection(self):
    counters['connection']+=1
    return Conn()
   async def batch_lookup_entries(self,forms,connection):
    counters['entries']+=1
    return {f:[dict(id=42,written_form=f,part_of_speech='명사',
                    origin_raw='法律',definition_preview='law')] for f in forms}
   async def get_definitions_for_entries(self,ids):
    counters['definitions']+=1
    return {i:['law'] for i in ids}
   async def get_metadata_for_entries(self,ids):
    counters['metadata']+=1
    return {i:dict(part_of_speech='명사') for i in ids}
  tokenizer=types.SimpleNamespace(is_available=True)
  engine=Engine(tokenizer=tokenizer,lookup_fn=lookup,fingerprint='test')
  await engine.initialize()
  engine.dictionary=Dictionary()
  for i in range(20):
   candidates=await engine.lookup_candidates_cached(['법률','국민','법률'])
   self.assertEqual(candidates['법률'][0]['origin_raw'],'法律')
   if i==0:candidates['법률'][0]['origin_raw']='mutated only this return copy'
   entries=await engine.lookup_entries(['법률','국민'])
   self.assertEqual(entries['법률'][0]['id'],42)
   self.assertEqual((await engine.cached_definitions([42]))[42],['law'])
   self.assertEqual((await engine.cached_metadata([42]))[42]['part_of_speech'],'명사')
  self.assertEqual(counters,dict(candidates=1,entries=1,definitions=1,
                                 metadata=1,connection=1))

if __name__=='__main__':unittest.main(verbosity=2)
