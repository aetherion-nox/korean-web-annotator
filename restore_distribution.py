from pathlib import Path
import hashlib,io,urllib.request,zipfile
ROOT=Path(__file__).resolve().parent
URL='https://github.com/aetherion-nox/korean-web-annotator/releases/download/v1.1.42/Korean-Web-Annotator-v1.1.42.zip'
EXPECTED='f05dc0858995ed2398ffb024b06f5f8c9a723c3f478e18b98312e40059c9ba5d'
print('Downloading verified bundled runtime...')
data=urllib.request.urlopen(URL,timeout=180).read()
if hashlib.sha256(data).hexdigest()!=EXPECTED:raise SystemExit('Archive checksum mismatch')
with zipfile.ZipFile(io.BytesIO(data)) as archive:
 for name in archive.namelist():
  parts=Path(name).parts[1:]
  if not parts or parts[0] not in {'runtime','icons'} or '..' in parts or name.endswith('/'):continue
  target=ROOT.joinpath(*parts);target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(archive.read(name))
print('Runtime restored. Load this folder as an unpacked extension.')
