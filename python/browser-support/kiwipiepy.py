"""Kiwi WASM host adapter; classification stays in the unchanged tokenizer."""
import json
from types import SimpleNamespace
_callback = None

def configure(callback):
    global _callback
    _callback = callback

def python_offset(text, offset):
    if not isinstance(offset, int) or offset < 0:
        raise ValueError('Invalid Kiwi UTF-16 offset')
    units = 0
    for index, char in enumerate(text):
        if units == offset:
            return index
        units += 2 if ord(char) > 0xffff else 1
        if units > offset:
            raise ValueError('Kiwi offset splits a surrogate pair')
    if units == offset:
        return len(text)
    raise ValueError('Kiwi offset exceeds source text')

class Kiwi:
    def __init__(self, *args, **kwargs):
        if _callback is None:
            raise RuntimeError('Kiwi WASM tokenizer has not been configured')
    def tokenize(self, text):
        raw = _callback(text)
        if not isinstance(raw, (str, list, dict)) and hasattr(raw, 'to_py'):
            raw = raw.to_py()
        if isinstance(raw, str):
            raw = json.loads(raw)
        if isinstance(raw, dict):
            raw = raw['tokens']
        result = []
        for token in raw:
            position = token.get('position', token.get('start'))
            start = python_offset(text, position)
            length = token.get('len', token.get('length'))
            end = python_offset(text, position + length)
            result.append(SimpleNamespace(form=token.get('str', token.get('form')), tag=token['tag'], start=start, len=end-start))
        return result
