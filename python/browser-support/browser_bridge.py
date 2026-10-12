"""Host adaptation only: unchanged Python rules and importer run inside Pyodide."""
import asyncio
import contextlib
import io
import json
import os
from pathlib import Path
import runpy
import sys
import types

ROOT = Path(__file__).resolve().parents[2]
DB_PATH = '/dictionary/hanja_dict.db'
_engine = None

async def _to_thread(func, /, *args, **kwargs):
    return func(*args, **kwargs)

def configure(tokenizer, project_root=None, database=DB_PATH):
    """Install a synchronous JSON-producing Kiwi WASM callback in this worker."""
    global _engine, ROOT, DB_PATH
    if project_root is not None: ROOT = Path(project_root)
    DB_PATH = database
    if str(ROOT) not in sys.path: sys.path.insert(0, str(ROOT))
    import kiwipiepy
    kiwipiepy.configure(tokenizer)
    asyncio.to_thread = _to_thread
    upstream = str(ROOT / 'backend' / 'upstream')
    if upstream not in sys.path:
        sys.path.insert(0, upstream)
    # The native bootstrap launches subprocesses. The browser only needs its
    # source-path setup; the unchanged CLI is invoked below in this interpreter.
    bootstrap = types.ModuleType('backend.bootstrap')
    bootstrap.ensure_environment = lambda: None
    sys.modules['backend.bootstrap'] = bootstrap
    _engine = None

async def _get_engine(db_path=None):
    global _engine
    db_path = db_path or DB_PATH
    from backend.analysis import Engine
    if _engine is None or str(_engine.db_path) != str(Path(db_path)):
        _engine = Engine(db_path)
    await _engine.initialize()
    return _engine

async def analyze(text, modes, db_path=None):
    if isinstance(modes, str): modes = json.loads(modes)
    return await (await _get_engine(db_path)).analyze(text, modes)

async def status(db_path=None):
    # Database state does not require a tokenizer or model initialization.
    import sqlite3
    from contextlib import closing
    from app.database import validate_database
    from app.services.dictionary import DictionaryService
    from backend.analysis import ENGINE_VERSION
    database = Path(db_path or DB_PATH).resolve()
    validate_database(database)
    with closing(sqlite3.connect(database.as_uri()+'?mode=ro',uri=True)) as connection:
        connection.row_factory = sqlite3.Row
        row = connection.execute('SELECT sha256,source_filename,data_version,total_entries,total_senses FROM import_metadata LIMIT 1').fetchone()
        if not row or not row['sha256']:
            raise ValueError('Database lacks dictionary import metadata; use the original dictionary importer.')
        metadata = {key:row[key] for key in row.keys() if key!='sha256'}
        fingerprint = row['sha256']
    return {'ready':True,'engine_version':ENGINE_VERSION,'dictionary_fingerprint':fingerprint,
            'dictionary_metadata':metadata,'dictionary':await DictionaryService(str(database)).get_stats(),'runtime':'browser'}

async def import_database(source, db_path=None):
    """Validate a completed original-importer DB before atomically replacing it."""
    global _engine
    import sqlite3
    from contextlib import closing
    source = Path(source).resolve()
    destination = Path(db_path or DB_PATH).resolve()
    result = await status(source)
    with closing(sqlite3.connect(source.as_uri()+'?mode=ro',uri=True)) as connection:
        if connection.execute('PRAGMA quick_check').fetchall() != [('ok',)]:
            raise ValueError('Dictionary database integrity check failed.')
    destination.parent.mkdir(parents=True,exist_ok=True)
    os.replace(source,destination)
    _engine = None
    return {'imported':True,**result}

async def tokens(text, db_path=None):
    from dataclasses import asdict
    return [asdict(t) for t in await (await _get_engine(db_path)).tokens(text)]

class _Capture(io.StringIO):
    def reconfigure(self, **kwargs): pass

def import_dictionary(zip_path, db_path=None):
    """Run the pinned original importer; its staging preserves a prior DB on error."""
    global _engine
    db_path = db_path or DB_PATH
    source = ROOT / 'backend' / 'upstream' / 'scripts' / 'import_dictionary.py'
    Path(db_path).parent.mkdir(parents=True, exist_ok=True)
    old_argv = sys.argv[:]
    old_environment = os.environ.get('HANJA_DB_PATH')
    capture = _Capture()
    try:
        sys.argv = [str(source),str(zip_path)]
        os.environ['HANJA_DB_PATH'] = str(Path(db_path).resolve())
        with contextlib.redirect_stdout(capture), contextlib.redirect_stderr(capture):
            try: runpy.run_path(str(source),run_name='__main__')
            except SystemExit as exc:
                if exc.code not in (None,0):
                    raise RuntimeError('Dictionary import failed:\n'+capture.getvalue()[-12000:]) from exc
        _engine = None
        return {'imported':True, 'log':capture.getvalue()[-12000:]}
    finally:
        sys.argv = old_argv
        if old_environment is None: os.environ.pop('HANJA_DB_PATH',None)
        else: os.environ['HANJA_DB_PATH'] = old_environment

async def analyze_json(text, modes, db_path=None): return json.dumps(await analyze(text,modes,db_path),ensure_ascii=False)
async def status_json(db_path=None): return json.dumps(await status(db_path),ensure_ascii=False)
def import_dictionary_json(zip_path, db_path=None): return json.dumps(import_dictionary(zip_path,db_path),ensure_ascii=False)

async def request(raw):
    message = json.loads(raw) if isinstance(raw,str) else raw
    action = message.get('action')
    database = message.get('db_path', DB_PATH)
    if action == 'status' and not Path(database).is_file():
        result = {'ready':False,'runtime':'browser','dictionary':None}
    elif action in ('status','initialize'):
        result = await status(database)
    elif action == 'analyze':
        result = await analyze(message['text'],message.get('modes',{}),database)
    elif action == 'import-db':
        result = await import_database(message['path'],database)
    elif action == 'import':
        result = import_dictionary(message.get('zip_path',message.get('path')),database)
        result.update(await status(database))
    else:
        raise ValueError('Unknown browser engine action: '+str(action))
    return json.dumps(result,ensure_ascii=False)

async def initialize(db_path=None):
    return await status(db_path or DB_PATH)
