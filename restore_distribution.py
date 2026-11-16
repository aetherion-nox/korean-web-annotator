from pathlib import Path
import hashlib, io, urllib.request, zipfile
ROOT = Path(__file__).resolve().parent
URL = "https://github.com/aetherion-nox/korean-web-annotator/releases/download/v1.0.0/Korean-Web-Annotator-v1.0.0.zip"
EXPECTED = "a5b01f812feb99d09b60ccf83b3cd3a58df62094488291503dd5065142a4526b"
data = urllib.request.urlopen(URL, timeout=180).read()
if hashlib.sha256(data).hexdigest() != EXPECTED: raise SystemExit("Archive checksum mismatch")
with zipfile.ZipFile(io.BytesIO(data)) as archive:
    for name in archive.namelist():
        parts=Path(name).parts[1:]
        if not parts or parts[0] not in {"runtime","icons"} or ".." in parts or name.endswith("/"): continue
        target=ROOT.joinpath(*parts); target.parent.mkdir(parents=True,exist_ok=True); target.write_bytes(archive.read(name))
print("Runtime restored.")
