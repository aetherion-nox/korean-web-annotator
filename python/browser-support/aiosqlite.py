"""Single-worker async SQLite interface for Pyodide's standard sqlite3.

Only scheduling changes: the original dictionary SQL and sqlite3.Row stay intact.
"""
import sqlite3
Row = sqlite3.Row
class Cursor:
    def __init__(self, cursor): self._cursor = cursor
    def __await__(self):
        async def ready(): return self
        return ready().__await__()
    async def __aenter__(self): return self
    async def __aexit__(self, *args): self._cursor.close()
    async def fetchall(self): return self._cursor.fetchall()
    async def fetchone(self): return self._cursor.fetchone()
    async def close(self): self._cursor.close()
class Connection:
    def __init__(self, *args, **kwargs): self._connection = sqlite3.connect(*args, **kwargs)
    def __await__(self):
        async def ready(): return self
        return ready().__await__()
    async def __aenter__(self): return self
    async def __aexit__(self, *args): await self.close()
    @property
    def row_factory(self): return self._connection.row_factory
    @row_factory.setter
    def row_factory(self, value): self._connection.row_factory = value
    def execute(self, sql, parameters=()): return Cursor(self._connection.execute(sql, parameters))
    def executemany(self, sql, parameters): return Cursor(self._connection.executemany(sql, parameters))
    async def commit(self): self._connection.commit()
    async def rollback(self): self._connection.rollback()
    async def close(self): self._connection.close()
def connect(*args, **kwargs): return Connection(*args, **kwargs)
