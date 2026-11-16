import asyncio,inspect,json,sqlite3,sys,tempfile,types,unittest
from pathlib import Path
ROOT=Path(sys.argv[1] if len(sys.argv)>1 else str(Path(__file__).resolve().parents[1])).resolve()
sys.argv=sys.argv[:1]
sys.path[:0]=[str(ROOT/'python'),str(ROOT/'python/backend/upstream')]
bootstrap=types.ModuleType('backend.bootstrap');bootstrap.ensure_environment=lambda:None;sys.modules['backend.bootstrap']=bootstrap
from app.schema import SCHEMA_SQL
from app.services.tokenizer import TokenizerService
from app.services.disambiguation import DisambiguationService
from app.services.converter import ConverterService
from app.services.dictionary import DictionaryService
from backend.analysis import Engine
TOKENS=json.loads(Path(__file__).with_name('quantity-tokens.json').read_text())
HEAD='수능 2주앞… ‘AI 스마트안경’ 부정행위 차단 비상'
class FrozenKiwi:
 def tokenize(self,text):return [types.SimpleNamespace(form=t['str'],tag=t['tag'],start=t['position'],len=t['length']) for t in TOKENS[text]]
def tokenizer():
 t=TokenizerService.__new__(TokenizerService);t._available=True;t._kiwi=FrozenKiwi();t._tokenize_lock=asyncio.Semaphore(1);return t
class Tests(unittest.IsolatedAsyncioTestCase):
 async def asyncSetUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.path=Path(self.tmp.name)/'dict.db';self.i=0
  with sqlite3.connect(self.path) as db:
   db.executescript(SCHEMA_SQL);db.execute("INSERT INTO import_metadata VALUES(1,'fixture','abc','now','fixture',50,50,0,50)")
  self.add('주','主','명사','주요하거나 기본이 되는 것을 이르는 말.')
  self.add('주','週','의존 명사','이레 동안을 세는 단위.')
  self.add('주','周','의존 명사','어떤 것의 둘레를 돈 횟수를 세는 단위.')
  self.add('주','株','의존 명사','식물, 특히 나무를 세는 단위.')
  self.add('주 연료 차단 장치','主燃料遮斷裝置',None,'연료를 차단하는 장치.')
  for w,o in [('남','南'),('박','朴'),('사','史'),('김','金')]:self.add(w,o,'명사','우리나라 성(姓)의 하나.')
  for w,o in [('상원','上院'),('보검','寶劍'),('혜','惠'),('준','準'),('철수','撤收'),('영희','英姬')]:self.add(w,o,'명사','일반 명사 뜻.')
  self.add('사무실','事務室','명사','사무를 보는 방.');self.add('남학생','男學生','명사','남자 학생.')
  self.add('학교','學校','명사','교육 기관.');self.add('년','年','의존 명사','해를 세는 단위.')
  self.add('게임기','game機','명사','게임을 하는 기계.')
  self.dictionary=DictionaryService(str(self.path))
 async def asyncTearDown(self):self.tmp.cleanup()
 def add(self,w,o,pos,d):
  self.i+=1
  with sqlite3.connect(self.path) as db:
   db.execute('INSERT INTO entries(id,target_code,written_form,part_of_speech,origin_raw,raw_json) VALUES(?,?,?,?,?,?)',(self.i,self.i,w,pos,o,'{}'))
   db.execute('INSERT INTO senses(entry_id,sense_number,definition) VALUES(?,?,?)',(self.i,1,d))
   if o and all('\u3400'<=c<='\u9fff' for c in o) and len(o)==len(w.replace(' ','')):
    db.execute('INSERT INTO conversion_candidates(written_form,entry_id,origin_raw,replacement,replacement_type,is_reliable) VALUES(?,?,?,?,?,1)',(w,self.i,o,o,'pure_hanja'))
  return self.i
 async def engine(self,text,**modes):return await Engine(self.path,tokenizer=tokenizer()).analyze(text,dict(hanja=True,loanword=True,**modes))
 async def segment(self,text):
  d=DisambiguationService(await self.dictionary.load_collocations());ss,_=await ConverterService(tokenizer(),d).convert(text,self.dictionary.batch_lookup_candidates)
  return next(s for s in ss if s.original=='주')
 async def test_quantity_bonus(self):
  for text in ['2주','2 주',HEAD]:
   s=await self.segment(text)
   scores={c['replacement']:c['score'] for c in s.candidates}
   self.assertAlmostEqual(scores['週'],.85)
   self.assertAlmostEqual(scores['主'],.80 if text==HEAD else .55)
   self.assertEqual(s.status,'ambiguous')
 async def test_no_bonus_without_numeric_adjacency(self):
  from app.services.quantity import has_quantity_before
  for text in ['2, 주','주 연료 차단 장치']:
   self.assertFalse(has_quantity_before(text,tokenizer().tokenize(text),text.index('주')))
 async def test_numeric_dependent_noun_needs_no_definition_keywords(self):
  self.add('주','舟','의존 명사','의존하여 쓰이는 말.')
  s=await self.segment('2주')
  self.assertAlmostEqual(next(c['score'] for c in s.candidates if c['replacement']=='舟'),.85)
 async def test_dependent_noun_aliases_and_missing_definitions(self):
  for pos,definition in [('불완전 명사',''),(' 불완전  명사 ','사람 수.'),('의존 명사','사람 수.'),('依存名詞','사람을 세는 단위.'),('不完全名词',''),('不完全名詞','인원을 뜻함.'),('依存名词',''),(' 의존  명사 ','')]:
   with self.subTest(pos=pos):
    self.dictionary._candidate_cache.clear()
    key=self.add('명','名',pos,definition)
    rows=(await self.dictionary.batch_lookup_candidates(['명']))['명']
    row=next(r for r in rows if r['entry_id']==key)
    d=DisambiguationService()
    numeric=d.score_candidates([row],token_tag='NNB',quantity=True)[0]
    plain=d.score_candidates([row],token_tag='NNB',quantity=False)[0]
    self.assertAlmostEqual(numeric.score,.85)
    self.assertAlmostEqual(plain.score,.55)
    self.assertIn('quantity_unit_bonus',numeric.reasons)
    self.assertNotIn('quantity_unit_bonus',plain.reasons)
    self.dictionary._candidate_cache.clear()
 async def test_non_dependent_entries_get_no_quantity_bonus(self):
  for pos in ['명사','名詞','접사','接辭',None]:
   with self.subTest(pos=pos):
    d=DisambiguationService()
    c=dict(entry_id=1,written_form='명',origin_raw='名',replacement='名',replacement_type='pure_hanja',is_reliable=True,part_of_speech=pos,unit_usage=True)
    for tag in ['NNB','NNG','XSN']:
     scored=d.score_candidates([c],token_tag=tag,quantity=True)
     self.assertTrue(all('quantity_unit_bonus' not in x.reasons for x in scored))
 async def test_multiple_dependent_senses_stay_ambiguous(self):
  self.add('주','舟','依存名詞','다른 뜻.')
  segment=await self.segment('2주')
  scores={c['replacement']:c['score'] for c in segment.candidates}
  self.assertAlmostEqual(scores['舟'],.85)
  self.assertAlmostEqual(scores['週'],.85)
  self.assertEqual(segment.status,'ambiguous')
 async def test_other_units_and_later_sense(self):
  c=(await self.dictionary.batch_lookup_candidates(['년']))['년']
  d=DisambiguationService()
  self.assertAlmostEqual(d.score_candidates(c,token_tag='NNB',quantity=True)[0].score,.85)
  self.assertAlmostEqual(d.score_candidates([dict(c[0],part_of_speech='명사')],token_tag='NNG',quantity=True)[0].score,.55)
 async def test_later_sense_is_used_only_for_its_entry(self):
  key=self.add('주','注','의존 명사','다른 뜻.')
  with sqlite3.connect(self.path) as db:
   db.execute('INSERT INTO senses(entry_id,sense_number,definition) VALUES(?,?,?)',(key,2,'양을 재는 단위.'))
  s=await self.segment('2주')
  self.assertAlmostEqual(next(c['score'] for c in s.candidates if c['entry_id']==key),.85)
 async def test_native_unit_competitor_remains_ambiguous(self):
  self.add('주',None,'의존 명사','수를 세는 단위.')
  s=await self.segment('2주')
  self.assertEqual(s.status,'ambiguous')
  self.assertTrue(any(not c['replacement'] for c in s.candidates))
 async def test_numeric_adjacency_does_not_cross_words_or_punctuation(self):
  from app.services.quantity import has_quantity_before
  for text,tag,expected in [('두 주','NR',True),('2 주','SN',True),('2, 주','SN',False),('2 학교 주','SN',False),('큰 주','MM',False)]:
   previous=types.SimpleNamespace(form=text.split()[0].rstrip(','),tag=tag,start=0,length=1)
   self.assertEqual(has_quantity_before(text,[previous],text.index('주')),expected,text)
 async def test_name_protection_toggle(self):
  for text in ['남상원의 욕망','사혜준이 죽었네.']:
   on=await self.engine(text)
   off=await self.engine(text,nameProtection=False)
   self.assertGreater(on['stats']['protected_names'],0,text)
   self.assertEqual(off['stats']['protected_names'],0)
   self.assertTrue(off['annotations'] or off['targets'],text)
   length=len(text.split()[0])-1
   self.assertFalse(any(x['start']<length for x in on['annotations']+on['targets']),text)
 async def test_ordinary_words_remain(self):
  for text in ['사무실이 비었다.','남학생이 왔다.']:
   r=await self.engine(text)
   self.assertEqual(r['stats']['protected_names'],0,text)
if __name__=='__main__':unittest.main(verbosity=2)
