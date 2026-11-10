from pathlib import Path
import hashlib,io,urllib.request,zipfile
ROOT=Path(__file__).resolve().parent
URL='https://github.com/aetherion-nox/korean-web-annotator/releases/download/v1.1.55/Korean-Web-Annotator-v1.1.55.zip'
EXPECTED='fde4f8a54a281d97b181daaa7faf21cf9e5c5cdc8672f9964dccce6a5118a2a6'
print('Downloading verified bundled runtime...')
data=urllib.request.urlopen(URL,timeout=180).read()
if hashlib.sha256(data).hexdigest()!=EXPECTED:raise SystemExit('Archive checksum mismatch')
with zipfile.ZipFile(io.BytesIO(data)) as archive:
 for name in archive.namelist():
  parts=Path(name).parts[1:]
  if not parts or parts[0] not in {'runtime','icons'} or '..' in parts or name.endswith('/'):continue
  target=ROOT.joinpath(*parts);target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(archive.read(name))
print('Runtime restored. Load this folder as an unpacked extension.')
