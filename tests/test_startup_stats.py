"""Reuse full dictionary counts while retaining replacement and schema validation."""
import sys,unittest,sqlite3
from pathlib import Path
from unittest.mock import patch
import test_quantity_bonus as fixture
sys.path.insert(0,str(fixture.ROOT/'python/browser-support'))
import browser_bridge as bridge
from app.services.dictionary import DictionaryService
class Tests(unittest.IsolatedAsyncioTestCase):
 asyncSetUp=fixture.Tests.asyncSetUp
 asyncTearDown=fixture.Tests.asyncTearDown
 add=fixture.Tests.add
 async def test_stats_reused_and_invalidated_by_file_change(self):
  original=DictionaryService.get_stats;calls=[]
  async def counted(service):
   calls.append(service);return await original(service)
  with patch.object(DictionaryService,'get_stats',counted):
   first=await bridge.status(self.path);again=await bridge.status(self.path)
   self.assertEqual(first,again);self.assertEqual(len(calls),1)
   self.add('회사','會社','명사','일하는 곳.')
   updated=await bridge.status(self.path)
   self.assertNotEqual(first['dictionary'],updated['dictionary']);self.assertEqual(len(calls),2)
   with sqlite3.connect(self.path) as db:db.execute('DROP TABLE entries')
   with self.assertRaises(Exception):await bridge.status(self.path)
 async def test_atomic_import_invalidates_counts_and_failed_import_keeps_original(self):
  from contextlib import closing
  source=self.path.with_name('new.db');destination=self.path.with_name('main.db')
  for path in (source,destination):
   with closing(sqlite3.connect(self.path)) as original, closing(sqlite3.connect(path)) as target:
    original.backup(target);target.execute('PRAGMA journal_mode=DELETE')
  await bridge.status(destination)
  with closing(sqlite3.connect(source)) as db:
   db.execute("UPDATE import_metadata SET sha256='new'");db.commit()
  await bridge.import_database(source,destination)
  self.assertEqual((await bridge.status(destination))['dictionary_fingerprint'],'new')
  source.write_bytes(b'invalid')
  with self.assertRaises(Exception):await bridge.import_database(source,destination)
  self.assertEqual((await bridge.status(destination))['dictionary_fingerprint'],'new')
if __name__=='__main__':unittest.main(verbosity=2)
