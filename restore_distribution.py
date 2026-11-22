from pathlib import Path
import hashlib
import io
import urllib.request
import zipfile

ROOT = Path(__file__).resolve().parent
URL = 'https://github.com/aetherion-nox/korean-web-annotator/releases/download/v1.0.0/Korean-Web-Annotator-v1.0.0.zip'
EXPECTED = 'a5b01f812feb99d09b60ccf83b3cd3a58df62094488291503dd5065142a4526b'
print('Downloading verified bundled browser runtime...')
data = urllib.request.urlopen(URL, timeout=180).read()
if hashlib.sha256(data).hexdigest() != EXPECTED:
    raise SystemExit('Runtime ZIP checksum mismatch')
with zipfile.ZipFile(io.BytesIO(data)) as package:
    if package.testzip() is not None:
        raise SystemExit('Runtime ZIP integrity check failed')
    for name in package.namelist():
        parts = Path(name).parts[1:]
        if not parts or parts[0] not in {'runtime', 'icons'} or '..' in parts or name.endswith('/'):
            continue
        if parts == ('runtime', 'python-sources.json'):
            continue  # Preserve the current source version of the Python engine.
        target = ROOT.joinpath(*parts)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(package.read(name))
print('Runtime restored. Load this folder as an unpacked extension.')
