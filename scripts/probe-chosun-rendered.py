from pathlib import Path
from bs4 import BeautifulSoup, NavigableString
import subprocess, shutil, json, re

URL="https://www.chosun.com/national/incident/2026/11/13/2J5YNC5XBNEBDLXRCHIT7HBHO4/"
OUT=Path("chosun-probe");OUT.mkdir(exist_ok=True)
binary=next((shutil.which(x) for x in ["google-chrome","google-chrome-stable","chromium","chromium-browser"] if shutil.which(x)),None)
print("HEADLESS_CHROME",binary,flush=True)
if not binary:
 raise SystemExit(0)
cmd=[binary,"--headless","--no-sandbox","--disable-gpu","--disable-dev-shm-usage",
 "--disable-background-networking","--virtual-time-budget=16000","--dump-dom",URL]
try:
 p=subprocess.run(cmd,capture_output=True,text=True,timeout=95)
 print("CHROME_RETURN",p.returncode,"STDOUT",len(p.stdout),"STDERR",p.stderr[-1100:],flush=True)
 if not p.stdout.lstrip().startswith("<"):
  print("NOT_HTML",p.stdout[:800],flush=True);raise SystemExit(0)
 html=p.stdout
 (OUT/"rendered.html").write_text(html,encoding="utf-8")
 soup=BeautifulSoup(html,"lxml")
 scripts=soup.select("script")
 for script in scripts: script.decompose()
 body=soup.body
 alltext=body.get_text(" ",strip=True) if body else ""
 print("RENDERED_META",json.dumps({
  "title":soup.title.get_text(strip=True) if soup.title else "",
  "body_text_len":len(alltext),"body_tags":len(body.select("*")) if body else 0,
  "text_prefix":alltext[:300]},ensure_ascii=False),flush=True)
 nodes=[s for s in body.descendants if isinstance(s,NavigableString) and re.search(r"[가-힣]",str(s))] if body else []
 for term in ["오늘의 인기정보","많이 본 정보","인기정보","많이 본","오늘의 인기"]:
  print("RENDERED_TERM",term,"raw",html.count(term),"text",alltext.count(term),flush=True)
  for s in nodes:
   if term not in s:continue
   index=nodes.index(s)
   el=s.parent
   ancestors=[]
   for _ in range(7):
    if not getattr(el,"name",None):break
    attrs={k:(" ".join(v) if isinstance(v,list) else str(v))[:250] for k,v in el.attrs.items()}
    ancestors.append({"tag":el.name,"attrs":attrs})
    el=el.parent
   print("RENDERED_TARGET",json.dumps({"node_index":index,"node_total":len(nodes),
    "ancestors":ancestors,"text":str(s).strip()[:250],
    "parent_html":str(s.parent)[:900]},ensure_ascii=False),flush=True)
except Exception as e:
 print("CHROME_FAILED",type(e).__name__,str(e),flush=True)
