"""Rebuild bundled runtime files and the original installation ZIP."""
import hashlib,json
from pathlib import Path
root=Path(__file__).resolve().parent
for item in json.loads((root/'distribution/parts.json').read_text()):
    data=b''.join((root/p).read_bytes() for p in item['parts'])
    if hashlib.sha256(data).hexdigest()!=item['sha256']:
        raise SystemExit('Checksum mismatch: '+item['path'])
    target=root/item['path'];target.parent.mkdir(parents=True,exist_ok=True)
    target.write_bytes(data)
    print('Restored:',item['path'])
