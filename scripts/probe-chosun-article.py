from __future__ import annotations
import os,re,json,html
from pathlib import Path
from urllib.parse import urlsplit
import requests
from bs4 import BeautifulSoup, NavigableString

URL="https://www.chosun.com/national/incident/2026/11/13/2J5YNC5XBNEBDLXRCHIT7HBHO4/"
OUT=Path("chosun-probe");OUT.mkdir(exist_ok=True)
TERMS=["오늘의 인기정보","많이 본 정보","인기정보","많이 본"]
headers={
  "User-Agent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  "Accept":"text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language":"ko-KR,ko;q=0.9,en-US;q=0.7,en;q=0.6",
  "Referer":"https://www.google.com/"
}
targets=[("article",URL),("mobile","https://m.chosun.com/national/incident/2026/11/13/2J5YNC5XBNEBDLXRCHIT7HBHO4/")]
for label,url in targets:
 try:
  response=requests.get(url,headers=headers,timeout=35,allow_redirects=True)
  response.encoding="utf-8"
  raw=response.text
  file=OUT/f"{label}.html";file.write_text(raw,encoding="utf-8")
  print(f"FETCH {label} status={response.status_code} size_bytes={len(response.content)} final_url={response.url} content_type={response.headers.get('content-type')} title={raw.find('<title>')}",flush=True)
  print("HEAD "+raw[:360].replace("\n"," ")[:360],flush=True)
  soup=BeautifulSoup(raw,"lxml")
  print("META "+json.dumps({"title":soup.title.get_text(" ",strip=True) if soup.title else "", "body_length":len(soup.body.get_text(" ",strip=True)) if soup.body else 0,"scripts":len(soup.select("script")),"body_tags":len(soup.select("body *"))},ensure_ascii=False),flush=True)
  for term in TERMS:
   counts={"raw":raw.count(term),"unescaped_raw":html.unescape(raw).count(term),"body_text":soup.body.get_text(" ",strip=True).count(term) if soup.body else 0}
   print(f"TERM {label} {term} "+json.dumps(counts,ensure_ascii=False),flush=True)
   for m in list(re.finditer(re.escape(term),html.unescape(raw)))[:3]:
    before=html.unescape(raw)[max(0,m.start()-250):m.start()+len(term)+250]
    print("RAW_CONTEXT "+re.sub(r"\s+"," ",before)[:600],flush=True)
   for element in soup.find_all(string=lambda s:isinstance(s,str) and term in s):
    par=element.parent
    if not par:continue
    parent=par.parent
    ancestors=[]
    e=par
    for _ in range(5):
     if not e or not getattr(e,"name",None):break
     attrs={k:(" ".join(v) if isinstance(v,list) else str(v))[:130] for k,v in e.attrs.items()}
     ancestors.append({"tag":e.name,"attrs":attrs})
     e=e.parent
    print("TEXT_NODE "+json.dumps({"parent_tags":ancestors,"text":str(element).strip()[:200],"parent_html":str(par)[:1300]},ensure_ascii=False),flush=True)
  nodes=[s for s in soup.body.descendants if isinstance(s,NavigableString) and re.search(r"[가-힣]",str(s))] if soup.body else []
  for term in TERMS[:2]:
   indexes=[i for i,t in enumerate(nodes) if term in str(t)]
   print(f"HANGUL_NODE_POSITION {label} {term} indexes={indexes[:10]} total={len(nodes)}",flush=True)
 except Exception as e:
  print(f"FETCH_FAILED {label} {type(e).__name__}: {e}",flush=True)
