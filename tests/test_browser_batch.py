"""Verify that batched local analysis and reused SQLite connections are equivalent."""
import asyncio
import json
import re
import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT=Path(__file__).resolve().parents[1]
sys.path[:0]=[str(ROOT/'python/browser-support'),str(ROOT/'python'),str(ROOT/'python/backend/upstream')]
import browser_bridge
from app.schema import SCHEMA_SQL
from app.services import dictionary as dictionary_module

class BrowserBatch(unittest.IsolatedAsyncioTestCase):
 async def asyncSetUp(self):
  self.temp=tempfile.TemporaryDirectory()
  self.addCleanup(self.temp.cleanup)
  self.db=Path(self.temp.name)/'hanja_dict.db'
  with sqlite3.connect(self.db) as conn:
   conn.executescript(SCHEMA_SQL)
   conn.execute("INSERT INTO import_metadata VALUES(1,'test','testsha','now','fixture',2,2,0,2)")
   conn.execute("INSERT INTO entries(id,target_code,written_form,part_of_speech,origin_raw,raw_json) VALUES (1,1,'학교','명사','學校','{}')")
   conn.execute("INSERT INTO entries(id,target_code,written_form,part_of_speech,origin_raw,raw_json) VALUES (2,2,'법률','명사','法律','{}')")
   conn.execute("INSERT INTO senses(entry_id,sense_number,definition) VALUES (1,1,'학교는 학생을 가르치는 곳')")
   conn.execute("INSERT INTO senses(entry_id,sense_number,definition) VALUES (2,1,'국가의 법률')")
   conn.execute("INSERT INTO conversion_candidates(written_form,entry_id,origin_raw,replacement,replacement_type,is_reliable) VALUES ('학교',1,'學校','學校','pure_hanja',1)")
   conn.execute("INSERT INTO conversion_candidates(written_form,entry_id,origin_raw,replacement,replacement_type,is_reliable) VALUES ('법률',2,'法律','法律','pure_hanja',1)")
   conn.commit()
  def kiwi(text):
   return [{'str':m.group(),'tag':'NNG','position':m.start(),'length':len(m.group())}
           for m in re.finditer('학교|법률',text)]
  browser_bridge.configure(kiwi,ROOT,self.db)
  self.modes=dict(hanja=True,loanword=True,nameProtection=True,filterDictionaryPeople=True)

 @staticmethod
 def canonical(result):
  result=dict(result)
  result['stats']={k:v for k,v in result['stats'].items() if k!='timings_ms'}
  return result

 async def test_batch_matches_individual_local_choices_and_offsets(self):
  texts=['학교','법률','학교 및 법률','학교']
  batch=json.loads(await browser_bridge.request({'action':'analyze-batch','texts':texts,'modes':self.modes,'db_path':str(self.db)}))
  singles=[json.loads(await browser_bridge.request({'action':'analyze','text':t,'modes':self.modes,'db_path':str(self.db)})) for t in texts]
  self.assertEqual(len(batch),len(texts))
  self.assertEqual([self.canonical(b) for b in batch],[self.canonical(s) for s in singles])
  self.assertTrue(all(b['stats']['timings_ms']['total']>=0 for b in batch))

 async def test_batch_reuses_exactly_one_sqlite_read_connection(self):
  engine=await browser_bridge._get_engine(self.db)
  self.assertIsNotNone(engine.dictionary)
  original=dictionary_module.aiosqlite.connect
  calls=[]
  def tracked(*args,**kwargs):
   calls.append(args)
   return original(*args,**kwargs)
  with patch.object(dictionary_module.aiosqlite,'connect',tracked):
   await browser_bridge.request({'action':'analyze-batch','texts':['학교 법률','법률 학교','학교','법률'],
                                 'modes':self.modes,'db_path':str(self.db)})
  self.assertEqual(len(calls),1,'all 4 paragraphs share a single SQLite connection')
  self.assertIsNone(engine.dictionary._batch_read_db,'connection must close after batch')

 async def test_reject_oversized_or_invalid_batch(self):
  for texts in [[],['학교']*13,['a'*20001],['가'*16001]*4,[123],None]:
   with self.subTest(texts=str(texts)[:60]):
    with self.assertRaises(ValueError):
     await browser_bridge.request({'action':'analyze-batch','texts':texts,'modes':self.modes,'db_path':str(self.db)})

 async def test_real_progress_reports_each_paragraph_and_accurate_long_phase_events(self):
  events=[]
  def report(serialized):events.append(json.loads(serialized))
  # Progress is an optional UI transport, not part of the dictionary rules.
  def kiwi(text):
   return [{'str':m.group(),'tag':'NNG','position':m.start(),'length':len(m.group())}
           for m in re.finditer('학교|법률',text)]
  browser_bridge.configure(kiwi,ROOT,self.db,report)
  long_text='학교 '*370
  texts=['학교 법률',long_text,'법률']
  batch=json.loads(await browser_bridge.request(
   {'action':'analyze-batch','texts':texts,'modes':self.modes,'db_path':str(self.db)}))
  started=[e for e in events if e.get('stage')=='analysis-paragraph' and e.get('event')=='start']
  done=[e for e in events if e.get('stage')=='analysis-paragraph' and e.get('event')=='done']
  self.assertEqual([e['batchIndex'] for e in started],[1,2,3])
  self.assertEqual([e['batchDoneUnique'] for e in done],[1,2,3])
  self.assertEqual([e['sentenceCharacters'] for e in done],list(map(len,texts)))
  stage=[e for e in events if e.get('stage')=='analysis-phase']
  self.assertEqual({e['phase'] for e in stage},
   {'kiwi','converter','names','mixed','target_choices','loanwords','audits','target_finalize'})
  self.assertTrue(all(e['batchIndex']==2 and e['batchTotal']==3 for e in stage))
  self.assertTrue(all(e['event'] in ('start','done','checkpoint') for e in stage))
  checkpoints=[e for e in stage if e['event']=='checkpoint']
  self.assertTrue(checkpoints,'long paragraphs expose real substep boundaries')
  self.assertTrue(all(isinstance(e.get('processed'),int) and
      isinstance(e.get('total'),int) and 0<=e['processed']<=e['total'] for e in checkpoints))
  self.assertTrue(all(e['batchIndex']==2 and e['batchTotal']==3 for e in checkpoints))
  self.assertTrue({('converter','forms'),('converter','lookup'),
      ('converter','scoring'),('mixed','lookup'),('mixed','align')}
    <= {(e['phase'],e['substep']) for e in checkpoints})
  self.assertLess(len(checkpoints),30,
    'throttling must not flood the progress channel for one 1K text')
  self.assertTrue(all(e.get('substepElapsedMs',-1)>=0 for e in checkpoints))
  self.assertTrue(all(e.get('elapsedMs',-1)>=0 for e in stage if e['event']=='done'))
  self.assertEqual(len(batch),3)
  self.assertEqual(batch[1]['stats']['token_count'],370)
  self.assertGreaterEqual(batch[1]['stats']['option_count'],0)

 async def test_progress_callback_failure_does_not_change_lexical_results(self):
  def bad_progress(_):raise RuntimeError('display failed')
  browser_bridge._progress_callback=bad_progress
  text='학교 법률'
  got=json.loads(await browser_bridge.request(
   {'action':'analyze','text':text,'modes':self.modes,'db_path':str(self.db)}))
  # A failed telemetry sink may not alter candidates, even when no target
  # is generated because both forms auto-convert under the current modes.
  browser_bridge._progress_callback=None
  expected=json.loads(await browser_bridge.request(
   {'action':'analyze','text':text,'modes':self.modes,'db_path':str(self.db)}))
  self.assertEqual(got['targets'],expected['targets'])
  self.assertEqual(got['annotations'],expected['annotations'])

if __name__=='__main__':
 unittest.main(verbosity=2)
