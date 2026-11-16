import unittest,asyncio,types,sys
from pathlib import Path
ROOT=Path(sys.argv[1] if len(sys.argv)>1 else str(Path(__file__).resolve().parents[1])).resolve();sys.argv=sys.argv[:1]
sys.path[:0]=[str(ROOT/'python'),str(ROOT/'python/backend/upstream'),str(ROOT/'python/browser-support')]
from app.services.tokenizer import TokenizerService
from app.services.converter import ConverterService
from app.services.disambiguation import DisambiguationService

def tokenizer(raw):
 t=TokenizerService.__new__(TokenizerService);t._available=True;t._tokenize_lock=asyncio.Semaphore(1);t._kiwi=types.SimpleNamespace(tokenize=lambda text:[types.SimpleNamespace(form=f,tag=tag,start=a,len=n) for f,tag,a,n in raw]);return t

def candidate(word,pos,replacement,key=1):return dict(entry_id=key,written_form=word,origin_raw=replacement,replacement=replacement,replacement_type='pure_hanja',is_reliable=bool(replacement),part_of_speech=pos,homonym_number=1)
class Tests(unittest.IsolatedAsyncioTestCase):
 async def convert(self,text,raw,records):
  async def lookup(forms):return {f:[c for c in records if c['written_form']==f] for f in forms}
  return (await ConverterService(tokenizer(raw),DisambiguationService()).convert(text,lookup))[0]
 async def test_independent_modifier_classes(self):
  for word,tag,pos,hanja in [('사실상','MAG','부사','事實上'),('각','MM','관형사','各'),('만세','IC','감탄사','萬歲'),('및','MAJ','부사','及')]:
   ss=await self.convert(word,[(word,tag,0,len(word))],[candidate(word,pos,hanja)])
   self.assertTrue(any(s.display_text==hanja and s.status=='converted' for s in ss),(word,ss))
 async def test_exact_nominal_suffix_words_use_dictionary_whole_pos(self):
  for word,pos,hanja in [('사실상','부사','事實上'),('형식상','부사','形式上'),('일반적','관형사','一般的')]:
   raw=[(word[:-1],'NNG',0,len(word)-1),(word[-1],'XSN',len(word)-1,1)]
   ss=await self.convert(word,raw,[candidate(word,pos,hanja)])
   self.assertEqual([(s.original,s.display_text,s.status) for s in ss],[(word,hanja,'converted')])
 async def test_wrong_pos_homophone_does_not_enter_single_modifier_pool(self):
  ss=await self.convert('각',[('각','MM',0,1)],[candidate('각','관형사','各'),candidate('각','명사','角',2)])
  self.assertEqual([c['replacement'] for s in ss for c in s.candidates],['各'])
 async def test_particles_endings_and_bare_roots_stay_unconverted(self):
  for tag in ['JKB','EF','XR','XSN','XPN']:
   ss=await self.convert('가',[('가',tag,0,1)],[candidate('가','명사','可')]);self.assertFalse(any(s.status=='converted' for s in ss),tag)
 async def test_native_sense_still_prevents_automatic_conversion(self):
  ss=await self.convert('사실상',[('사실상','MAG',0,3)],[candidate('사실상','부사','事實上'),candidate('사실상','부사',None,2)])
  self.assertTrue(any(s.status=='ambiguous' for s in ss))
 async def test_irregular_predicate_tag_is_normalized_and_lemma_looked_up(self):
  for tag in ['VA-I','VA-R','VV-I','VV-R']:
   pos='형용사' if tag.startswith('VA') else '동사'
   t=tokenizer([('동일하',tag,0,3)]);self.assertTrue(t.tokenize('동일하')[0].is_verb_stem,tag)
   ss=await self.convert('동일하',[('동일하',tag,0,3)],[candidate('동일하다',pos,'同一하')]);self.assertTrue(any(s.status=='converted' for s in ss),tag)
 async def test_suffix_pattern_does_not_admit_predicate_or_interjection(self):
  for pos in ['동사','형용사','감탄사']:
   ss=await self.convert('사실상',[('사실','NNG',0,2),('상','XSN',2,1)],[candidate('사실상',pos,'事實上')]);self.assertFalse(any(s.status=='converted' for s in ss),pos)
 async def test_derived_word_ambiguity_stays_whole_for_review(self):
  ss=await self.convert('사실상',[('사실','NNG',0,2),('상','XSN',2,1)],[candidate('사실상','부사','事實上'),candidate('사실상','부사','寫室上',2)])
  self.assertEqual(len(ss),1);self.assertEqual(ss[0].status,'ambiguous');self.assertEqual(ss[0].original,'사실상')
 async def test_added_classes_use_unchanged_base_score(self):
  ss=await self.convert('사실상',[('사실상','MAG',0,3)],[candidate('사실상','부사','事實上')])
  self.assertAlmostEqual(ss[0].candidates[0]['score'],.55)
if __name__=='__main__':unittest.main(verbosity=2)
