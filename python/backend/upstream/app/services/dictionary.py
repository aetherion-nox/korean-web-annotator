"""
Dictionary service for querying the Korean dictionary database.
Provides lookups, search, and candidate retrieval.
"""

import aiosqlite
import json
import re
from collections import OrderedDict, defaultdict
from typing import List, Optional, Dict, Tuple, Any


class DictionaryService:
    def __init__(self, db_path: str):
        self.db_path = db_path
        self._candidate_cache = OrderedDict()
        self._max_cache = 20000
        self._stats = None
        self._collocations: Dict[str, List[dict]] = {}
        self._cjk_re = re.compile(r'[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]')

    async def get_connection(self) -> aiosqlite.Connection:
        db = await aiosqlite.connect(self.db_path)
        db.row_factory = aiosqlite.Row
        await db.execute('PRAGMA foreign_keys=ON')
        return db

    async def load_collocations(self, db: Optional[aiosqlite.Connection] = None) -> Dict[str, List[dict]]:
        """Index full dictionary phrases and each component's aligned origin."""
        if self._collocations:
            return self._collocations

        close_db = db is None
        if close_db:
            db = await self.get_connection()
        try:
            # Preserve every word of the originating phrase and its aligned origin.
            # Nonadjacent pairs from a long technical term are not collocations.
            query = "SELECT id, written_form, origin_raw FROM entries WHERE written_form LIKE '% %' AND origin_raw IS NOT NULL"
            async with db.execute(query) as cursor:
                rows = await cursor.fetchall()
            phrases = defaultdict(list)
            seen=set()
            for row in rows:
                words=tuple(row['written_form'].split())
                origin=row['origin_raw'].strip()
                if len(words)<2 or not all(re.fullmatch(r'[가-힣]+',w) for w in words):continue
                clean_origin=''.join(origin.split())
                if not re.fullmatch(r'[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]+',clean_origin) or len(clean_origin)!=sum(map(len,words)):continue
                offset=0
                for index,word in enumerate(words):
                    target_origin=clean_origin[offset:offset+len(word)];offset+=len(word)
                    key=(words,index,target_origin)
                    if key in seen:continue
                    seen.add(key)
                    phrases[word].append(dict(words=words,index=index,origin=target_origin))
            self._collocations=dict(phrases)
            return self._collocations
        finally:
            if close_db:
                await db.close()

    async def lookup_by_written_form(
        self, written_form: str, db: Optional[aiosqlite.Connection] = None
    ) -> List[dict]:
        """Look up entries by exact written_form match."""
        close_db = db is None
        if close_db:
            db = await self.get_connection()
        try:
            query = '''
                SELECT e.id, e.target_code, e.written_form, e.homonym_number, e.part_of_speech,
                       e.origin_raw, e.vocabulary_level,
                       (SELECT s.definition FROM senses s 
                        WHERE s.entry_id = e.id 
                        ORDER BY s.sense_number LIMIT 1) as definition_preview
                FROM entries e
                WHERE e.written_form = ?
                ORDER BY e.homonym_number ASC
            '''
            async with db.execute(query, (written_form,)) as cursor:
                rows = await cursor.fetchall()
                return [dict(row) for row in rows]
        finally:
            if close_db:
                await db.close()

    async def lookup_candidates(
        self, written_form: str, db: Optional[aiosqlite.Connection] = None
    ) -> List[dict]:
        """Include non-conversion readings from existing full dictionary entries."""
        return (await self.batch_lookup_candidates([written_form], db)).get(written_form, [])

    async def batch_lookup_candidates(
        self, written_forms: List[str], db: Optional[aiosqlite.Connection] = None
    ) -> Dict[str, List[dict]]:
        """Fast batch lookup for multiple written forms without slow subqueries."""
        result: Dict[str, List[dict]] = {}
        missing = []

        for wf in dict.fromkeys(written_forms):
            if wf in self._candidate_cache:
                self._candidate_cache.move_to_end(wf)
                result[wf] = self._candidate_cache[wf]
            else:
                missing.append(wf)
                result[wf] = []

        if not missing:
            return result

        close_db = db is None
        if close_db:
            db = await self.get_connection()
        try:
            batch_size = 400
            for i in range(0, len(missing), batch_size):
                batch = missing[i:i + batch_size]
                placeholders = ','.join(['?'] * len(batch))
                query = f'''
                    SELECT cc.id as candidate_id, cc.entry_id, cc.written_form,
                           cc.origin_raw, cc.replacement, cc.replacement_type,
                           cc.is_reliable,
                           e.part_of_speech, e.vocabulary_level, e.homonym_number
                    FROM conversion_candidates cc
                    JOIN entries e ON cc.entry_id = e.id
                    WHERE cc.written_form IN ({placeholders})
                    UNION ALL
                    SELECT NULL as candidate_id, e.id as entry_id, e.written_form,
                           e.origin_raw, NULL as replacement, NULL as replacement_type,
                           0 as is_reliable,
                           e.part_of_speech, e.vocabulary_level, e.homonym_number
                    FROM entries e
                    WHERE e.written_form IN ({placeholders})
                      AND NOT EXISTS (SELECT 1 FROM conversion_candidates cc WHERE cc.entry_id = e.id)
                    ORDER BY written_form, is_reliable DESC, homonym_number ASC
                '''
                async with db.execute(query, batch + batch) as cursor:
                    rows = [dict(row) for row in await cursor.fetchall()]
                ids=list(dict.fromkeys(row['entry_id'] for row in rows))
                evidence={i:dict(unit_usage=False,surname_usage=False,definition_preview=None) for i in ids}
                from app.services.usage import sense_evidence
                for begin in range(0,len(ids),400):
                    part=ids[begin:begin+400];marks=','.join('?' for _ in part)
                    async with db.execute(f'SELECT entry_id,definition FROM senses WHERE entry_id IN ({marks}) ORDER BY entry_id,sense_number,id',part) as cursor:
                        for sense in await cursor.fetchall():
                            flags=evidence[sense['entry_id']]
                            if flags['definition_preview'] is None:flags['definition_preview']=sense['definition']
                            for key,value in sense_evidence(sense['definition']).items():flags[key]|=value
                for row in rows:
                    row.update(evidence[row['entry_id']])
                    result.setdefault(row['written_form'],[]).append(row)

            for wf in missing:
                self._cache_candidates(wf, result.get(wf, []))

            return result
        finally:
            if close_db:
                await db.close()

    async def get_metadata_for_entries(self, entry_ids):
        ids=list(dict.fromkeys(i for i in entry_ids if i is not None))
        result={}
        if not ids:return result
        db=await self.get_connection()
        try:
            for start in range(0,len(ids),500):
                batch=ids[start:start+500];placeholders=','.join('?' for _ in batch)
                async with db.execute(f'SELECT id,written_form,part_of_speech FROM entries WHERE id IN ({placeholders})',batch) as cursor:
                    for row in await cursor.fetchall():result[row['id']]=dict(written_form=row['written_form'],part_of_speech=row['part_of_speech'])
            return result
        finally:
            await db.close()

    async def get_definitions_for_entries(self, entry_ids) -> Dict[int, List[str]]:
        """Fetch complete senses in batches without loading examples/metadata."""
        ids=list(dict.fromkeys(i for i in entry_ids if i is not None))
        result={i:[] for i in ids}
        if not ids:return result
        db=await self.get_connection()
        try:
            for start in range(0,len(ids),500):
                batch=ids[start:start+500]
                placeholders=','.join('?' for _ in batch)
                async with db.execute(f'SELECT entry_id,definition FROM senses WHERE entry_id IN ({placeholders}) ORDER BY entry_id,sense_number,id',batch) as cursor:
                    for row in await cursor.fetchall():
                        if row['definition']:result[row['entry_id']].append(row['definition'])
            return result
        finally:
            await db.close()

    async def get_entry_detail(
        self, entry_id: int, db: Optional[aiosqlite.Connection] = None, *, include_raw: bool = False
    ) -> Optional[dict]:
        """Get full entry details including all children."""
        close_db = db is None
        if close_db:
            db = await self.get_connection()
        try:
            # Query entry by id or target_code
            fields = 'id, target_code, written_form, variant, homonym_number, lexical_unit, part_of_speech, origin_raw, vocabulary_level, annotation, semantic_category, subject_category'
            if include_raw:
                fields += ', raw_json'
            async with db.execute(f'SELECT {fields} FROM entries WHERE id = ? OR target_code = ? ORDER BY CASE WHEN id = ? THEN 0 ELSE 1 END, id LIMIT 1', (entry_id, entry_id, entry_id)) as cursor:
                row = await cursor.fetchone()
                if not row:
                    return None
                entry = dict(row)

            actual_id = entry['id']

            if entry.get('raw_json'):
                try:
                    entry['raw_json_parsed'] = json.loads(entry['raw_json'])
                except json.JSONDecodeError:
                    entry['raw_json_parsed'] = None

            entry['senses'] = await self._get_senses(actual_id, db)

            async with db.execute(
                'SELECT * FROM word_forms WHERE entry_id = ? ORDER BY id', (actual_id,)
            ) as cursor:
                word_forms = [dict(r) for r in await cursor.fetchall()]

            representations = await self._load_children(db, 'form_representations', 'word_form_id', [wf['id'] for wf in word_forms])
            for wf in word_forms:
                wf['sub_forms'] = representations.get(wf['id'], [])
            entry['word_forms'] = word_forms

            async with db.execute(
                'SELECT * FROM related_forms WHERE entry_id = ? ORDER BY id', (actual_id,)
            ) as cursor:
                entry['related_forms'] = [dict(r) for r in await cursor.fetchall()]

            return entry
        finally:
            if close_db:
                await db.close()

    async def _get_senses(
        self, entry_id: int, db: aiosqlite.Connection
    ) -> List[dict]:
        async with db.execute(
            'SELECT * FROM senses WHERE entry_id = ? ORDER BY sense_number', (entry_id,)
        ) as cursor:
            senses = [dict(r) for r in await cursor.fetchall()]

        sense_ids = [sense['id'] for sense in senses]
        for table, key in [('equivalents', 'equivalents'), ('sense_examples', 'examples'), ('sense_relations', 'relations'), ('multimedia', 'multimedia')]:
            order = 'group_index, order_index, id' if table == 'sense_examples' else 'id'
            children = await self._load_children(db, table, 'sense_id', sense_ids, order)
            for sense in senses:
                sense[key] = children.get(sense['id'], [])

        return senses

    async def _load_children(self, db, table, foreign_key, ids, order='id'):
        # Identifiers are internal constants; values always use SQL parameters.
        grouped = defaultdict(list)
        for i in range(0, len(ids), 500):
            batch = ids[i:i+500]
            placeholders = ','.join('?' for _ in batch)
            async with db.execute(f'SELECT * FROM {table} WHERE {foreign_key} IN ({placeholders}) ORDER BY {order}', batch) as cursor:
                for row in await cursor.fetchall():
                    grouped[row[foreign_key]].append(dict(row))
        return grouped

    async def get_entry_raw(self, entry_id):
        db = await self.get_connection()
        try:
            async with db.execute('SELECT raw_json FROM entries WHERE id = ?', (entry_id,)) as cursor:
                row = await cursor.fetchone()
                return json.loads(row[0]) if row else None
        finally:
            await db.close()

    async def search_entries(
        self, query: str, search_type: str = 'written_form',
        page: int = 1, page_size: int = 20,
        db: Optional[aiosqlite.Connection] = None
    ) -> Tuple[List[dict], int]:
        """Search entries. Returns (results, total_count)."""
        close_db = db is None
        if close_db:
            db = await self.get_connection()

        offset = (page - 1) * page_size

        try:
            if search_type == 'entry_id':
                try:
                    eid = int(query)
                except ValueError:
                    return [], 0
                count_sql = 'SELECT COUNT(*) FROM entries WHERE id = ? OR target_code = ?'
                data_sql = '''
                    SELECT id, target_code, written_form, homonym_number, part_of_speech,
                           origin_raw, vocabulary_level,
                           (SELECT s.definition FROM senses s 
                            WHERE s.entry_id = entries.id 
                            ORDER BY s.sense_number LIMIT 1) as definition_preview
                    FROM entries WHERE id = ? OR target_code = ?
                    ORDER BY homonym_number ASC
                    LIMIT ? OFFSET ?
                '''
                count_params: tuple = (eid, eid)
                data_params: tuple = (eid, eid, page_size, offset)

            elif search_type == 'origin':
                like_param = f'%{query}%'
                count_sql = "SELECT COUNT(*) FROM entries WHERE origin_raw LIKE ?"
                data_sql = '''
                    SELECT id, target_code, written_form, homonym_number, part_of_speech,
                           origin_raw, vocabulary_level,
                           (SELECT s.definition FROM senses s 
                            WHERE s.entry_id = entries.id 
                            ORDER BY s.sense_number LIMIT 1) as definition_preview
                    FROM entries WHERE origin_raw LIKE ?
                    ORDER BY written_form
                    LIMIT ? OFFSET ?
                '''
                count_params = (like_param,)
                data_params = (like_param, page_size, offset)

            else:  # written_form (default)
                like_param = f'{query}%'
                count_sql = "SELECT COUNT(*) FROM entries WHERE written_form LIKE ?"
                data_sql = '''
                    SELECT id, target_code, written_form, homonym_number, part_of_speech,
                           origin_raw, vocabulary_level,
                           (SELECT s.definition FROM senses s 
                            WHERE s.entry_id = entries.id 
                            ORDER BY s.sense_number LIMIT 1) as definition_preview
                    FROM entries WHERE written_form LIKE ?
                    ORDER BY
                        CASE WHEN written_form = ? THEN 0 ELSE 1 END,
                        written_form, homonym_number
                    LIMIT ? OFFSET ?
                '''
                count_params = (like_param,)
                data_params = (like_param, query, page_size, offset)

            async with db.execute(count_sql, count_params) as cursor:
                total = (await cursor.fetchone())[0]

            if total == 0:
                return [], 0

            async with db.execute(data_sql, data_params) as cursor:
                results = [dict(r) for r in await cursor.fetchall()]

            return results, total
        finally:
            if close_db:
                await db.close()

    async def get_stats(
        self, db: Optional[aiosqlite.Connection] = None
    ) -> dict:
        """Get database statistics (dictionary is immutable during a service run)."""
        if self._stats is not None:
            return self._stats
        close_db = db is None
        if close_db:
            db = await self.get_connection()
        try:
            stats = {}

            async with db.execute('SELECT COUNT(*) FROM entries') as c:
                stats['total_entries'] = (await c.fetchone())[0]

            async with db.execute('SELECT COUNT(*) FROM senses') as c:
                stats['total_senses'] = (await c.fetchone())[0]

            async with db.execute('SELECT COUNT(*) FROM sense_examples') as c:
                stats['total_examples'] = (await c.fetchone())[0]

            async with db.execute(
                "SELECT COUNT(*) FROM entries WHERE origin_raw IS NOT NULL AND origin_raw != ''"
            ) as c:
                stats['entries_with_origin'] = (await c.fetchone())[0]

            async with db.execute(
                'SELECT COUNT(DISTINCT written_form) FROM conversion_candidates'
            ) as c:
                stats['unique_hangul_forms_with_origin'] = (await c.fetchone())[0]

            try:
                async with db.execute(
                    'SELECT * FROM import_metadata ORDER BY import_timestamp DESC LIMIT 1'
                ) as c:
                    row = await c.fetchone()
                    if row:
                        stats['import_info'] = dict(row)
                        stats['entries_with_hanja_origin'] = stats['import_info'].get('origin_entries', 34142)
            except Exception:
                stats['import_info'] = None
                stats['entries_with_hanja_origin'] = None

            self._stats = stats
            return stats
        finally:
            if close_db:
                await db.close()

    def _cache_candidates(self, form, candidates):
        self._candidate_cache[form] = candidates
        self._candidate_cache.move_to_end(form)
        if len(self._candidate_cache) > self._max_cache:
            self._candidate_cache.popitem(last=False)

    def invalidate_cache(self):
        self._candidate_cache.clear()
        self._collocations.clear()
        self._stats = None

    async def batch_lookup_origins(self, written_forms: List[str]) -> Dict[str, List[dict]]:
        """Return entry origins independently from conversion candidates."""
        result = {form: [] for form in written_forms}
        if not written_forms:
            return result
        db = await self.get_connection()
        try:
            for i in range(0, len(written_forms), 500):
                batch = written_forms[i:i + 500]
                placeholders = ','.join('?' for _ in batch)
                query = f'''SELECT id AS entry_id, written_form, origin_raw
                            FROM entries WHERE written_form IN ({placeholders})
                            ORDER BY written_form, homonym_number'''
                async with db.execute(query, batch) as cursor:
                    for row in await cursor.fetchall():
                        item = dict(row)
                        result[item['written_form']].append(item)
            return result
        finally:
            await db.close()

    async def get_entry_candidate_info(self, entry_id: int) -> Optional[dict]:
        """Look up candidate details and origin info for candidate selection validation."""
        db = await self.get_connection()
        try:
            async with db.execute('SELECT id, written_form, origin_raw FROM entries WHERE id = ?', (entry_id,)) as cursor:
                row = await cursor.fetchone()
            if not row:
                return None
            entry = dict(row)
            
            async with db.execute(
                'SELECT * FROM conversion_candidates WHERE entry_id = ? ORDER BY is_reliable DESC LIMIT 1',
                (entry_id,)
            ) as cursor:
                cand_row = await cursor.fetchone()
            
            candidate = dict(cand_row) if cand_row else None
            return {
                'entry': entry,
                'candidate': candidate,
            }
        finally:
            await db.close()

    def build_origin_dict(self, entry: dict) -> Optional[dict]:
        """Build structured origin data from dictionary entry."""
        raw = entry.get('origin_raw')
        if not raw:
            return {'type': 'native', 'language': 'Korean', 'raw': '고유어', 'entry_id': entry.get('id')}
        
        if re.search(r'[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]', raw):
            origin_type = 'hanja'
            language = 'Hanja'
        else:
            origin_type = 'loanword'
            language = 'English' if re.search(r'[A-Za-z]', raw) else None
        
        return {
            'type': origin_type,
            'language': language,
            'raw': raw,
            'entry_id': entry.get('id')
        }
