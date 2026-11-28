import {LOG_KEY,LOG_FULL_KEY,LOG_FULL_INDEX_KEY,LOG_FULL_LIMIT_KEY,LOG_ENABLED_KEY,FULL_RECORD_LIMIT,MAX_FULL_RECORD_LIMIT,fullLogStorageKey} from './request-log.js';
import {exportApiRequestBody,exportApiResponseJson,exportApiExchangeDiagnostic} from './api-log-export.js';
import {createZipArchive} from './zip-archive.js';
const $=id=>document.getElementById(id);
const copy={
 'zh-CN':{title:'显示与请求日志',progressive:'边完成边标注（流式标注）',displayHint:'开启后使用流式 API（模型支持时），立即显示本地结果及已完成的模型结果；关闭则使用非流式 API，完成后统一显示。新任务生效。',logging:'启用大模型请求日志',logHint:'默认关闭。仅在本机保存 API 请求、完整回复和原始流，包含网页正文及模型可能返回的思考内容；API Key 自动遮蔽。完整记录默认保存最近50组，支持调整与逐组删除，可能占用大量磁盘空间；单独的汇总日志仍采用50条/10MiB/单条2MiB限制。',download:'下载请求日志（JSON）',clear:'清空请求日志',saved:'设置已保存，立即生效。',cleared:'请求日志已清空。',empty:'暂无请求日志，请开启日志后运行标注或测试 API。',count:n=>`已保存 ${n} 条请求记录。`,exported:'请求日志已导出。',recent:"最近完整 API 请求／回复（逐组管理）",request:"下载请求 JSON",response:"下载返回 JSON",responsePending:"等待响应",debug:"下载原始流及诊断",responseMissing:"尚无完整 JSON 答案",limit:"保存最近几组完整请求／返回日志（1～500，默认50）",remove:"删除此组",deleted:"已删除这组请求与回复。",badLimit:"日志保存条数必须在 1～500 之间。",zipOne:"下载本组 ZIP",zipAll:"全部完整日志打包 ZIP",packing:"正在整理日志",zipDone:"ZIP 已生成，共",zipEmpty:"没有可打包的完整请求记录。"},
 'zh-TW':{title:'顯示與請求日誌',progressive:'邊完成邊標註（串流標註）',displayHint:'開啟後使用串流 API（模型支援時），立即顯示本機與已完成的模型結果；關閉則使用非串流 API，完成後顯示。新任務生效。',logging:'啟用大模型請求日誌',logHint:'預設關閉。僅在本機保存 API 請求、完整回應和原始串流，包含網頁內文及模型可能回傳的思考內容；API Key 自動遮蔽。完整記錄預設保留最近50組，可調整及逐組刪除，可能占用大量磁碟空間；摘要日誌仍受50筆/10MiB/每筆2MiB限制。',download:'下載請求日誌（JSON）',clear:'清空請求日誌',saved:'設定已儲存。',cleared:'請求日誌已清空。',empty:'暫無日誌，請開啟後執行標註或測試 API。',count:n=>`已儲存 ${n} 筆請求。`,exported:'日誌已匯出。',recent:"最近完整 API 請求／回應（逐組管理）",request:"下載請求 JSON",response:"下載回應 JSON",responsePending:"等待回應",debug:"下載原始串流及診斷",responseMissing:"尚無完整 JSON 回答",limit:"保存最近幾組完整請求／回應日誌（1～500，預設50）",remove:"刪除此組",deleted:"已刪除此組請求與回應。",badLimit:"日誌保存筆數必須介於 1～500。",zipOne:"下載本組 ZIP",zipAll:"全部完整日誌打包 ZIP",packing:"正在整理日誌",zipDone:"ZIP 已產生，共",zipEmpty:"沒有可打包的完整請求記錄。"},
 en:{title:'Display and request logs',progressive:'Show annotations as results arrive (streaming)',displayHint:'Use the streaming API when supported and display completed local and model results as they arrive. When off, use a non-streaming API and display results at completion. Applies to new tasks.',logging:'Enable model request logging',logHint:'Off by default. Locally stores full API requests, assembled responses and raw streams, including page text and any returned reasoning; credentials are redacted. Keep 50 complete exchanges by default, adjustable with per-exchange deletion. Full logs may use substantial disk space; the separate summary remains limited to 50 rows/10 MiB total/2 MiB each.',download:'Download request logs (JSON)',clear:'Clear request logs',saved:'Settings saved.',cleared:'Request logs cleared.',empty:'No logs yet. Enable logging, then annotate or test the API.',count:n=>`${n} saved request records.`,exported:'Request logs exported.',recent:"Recent full API exchanges (individual management)",request:"Download request JSON",response:"Download response JSON",responsePending:"Waiting for response",debug:"Download raw stream / diagnostics",responseMissing:"No complete JSON reply",limit:"Full request/response exchanges to keep (1–500; default 50)",remove:"Delete this exchange",deleted:"Exchange deleted.",badLimit:"Keep between 1 and 500 exchanges.",zipOne:"Download exchange ZIP",zipAll:"ZIP all full exchanges",packing:"Preparing logs",zipDone:"ZIP generated, total",zipEmpty:"No complete exchanges to export."},
 ja:{title:'表示とリクエストログ',progressive:'完了した注釈を順次表示（ストリーミング）',displayHint:'ローカルの結果とストリーム内の完全な候補を順次表示します。無効時は完了後に一括表示。次の処理から適用。',logging:'モデルのリクエストログを有効化',logHint:'初期設定は無効。APIの完全な要求・応答・生ストリームをローカル保存し、本文や返却された推論を含みます。認証情報はマスクされます。初期値50件で変更・個別削除が可能です。多くのディスク容量を使う場合があります。要約ログは50件／合計10MiB／1件2MiBのままです。',download:'ログをダウンロード（JSON）',clear:'ログを削除',saved:'保存しました。',cleared:'ログを削除しました。',empty:'ログがありません。有効にして注釈またはAPIテストを実行してください。',count:n=>`${n} 件のリクエスト記録。`,exported:'ログを出力しました。',recent:"最近の完全なAPI送受信（個別管理）",request:"リクエストJSON",response:"レスポンスJSON",responsePending:"応答待ち",debug:"生ストリーム・診断を保存",responseMissing:"完成したJSON応答なし",limit:"完全なAPI送受信の保存件数（1～500、初期値50）",remove:"この通信を削除",deleted:"この通信を削除しました。",badLimit:"保存件数は1～500にしてください。",zipOne:"この通信をZIP保存",zipAll:"全通信をZIP一括保存",packing:"ログを準備中",zipDone:"ZIP生成完了、計",zipEmpty:"ZIPにできる通信がありません。"},
 ko:{title:'표시 및 요청 로그',progressive:'완료된 주석부터 표시 (스트리밍)',displayHint:'로컬 결과와 스트림의 완전한 후보를 차례로 표시합니다. 끄면 전체 완료 후 표시합니다. 새 작업부터 적용됩니다.',logging:'모델 요청 로그 켜기',logHint:'기본 꺼짐. 웹 본문과 모델의 추론을 포함할 수 있는 전체 API 요청·응답·원본 스트림을 로컬에 저장하며 인증 정보는 가립니다. 기본 50개를 보관하고 개별 삭제 및 개수 변경이 가능합니다. 디스크 사용량이 많을 수 있습니다. 요약 로그는 여전히 50개/총 10MiB/건당 2MiB 제한입니다.',download:'요청 로그 다운로드 (JSON)',clear:'요청 로그 지우기',saved:'설정이 저장되었습니다.',cleared:'로그를 지웠습니다.',empty:'로그가 없습니다. 켠 후 주석 또는 API 테스트를 실행하세요.',count:n=>`요청 기록 ${n}개.`,exported:'로그를 내보냈습니다.',recent:"최근 전체 API 기록 (개별 관리)",request:"요청 JSON 다운로드",response:"응답 JSON 다운로드",responsePending:"응답 대기",debug:"원본 스트림/진단 다운로드",responseMissing:"완성된 JSON 응답 없음",limit:"전체 API 요청/응답 저장 개수(1~500, 기본 50)",remove:"이 기록 삭제",deleted:"이 기록을 삭제했습니다.",badLimit:"저장 개수는 1~500이어야 합니다.",zipOne:"이 요청 ZIP 다운로드",zipAll:"전체 기록 ZIP 다운로드",packing:"로그 준비 중",zipDone:"ZIP 생성 완료, 총",zipEmpty:"내보낼 전체 기록이 없습니다."}
};
const t=key=>(copy[$('uiLocale').value]||copy.en)[key];
function translate(){for(const el of document.querySelectorAll('[data-feature-i18n]'))el.textContent=t(el.dataset.featureI18n);}
// The summary keeps its original bounded storage policy. Full records remain
// separate, opt-in and untruncated; never interpolate stored text as HTML.
function downloadBlob(blob,filename){
 const url=URL.createObjectURL(blob),anchor=document.createElement('a');
 anchor.href=url;anchor.download=filename;document.body.append(anchor);anchor.click();anchor.remove();
 setTimeout(()=>URL.revokeObjectURL(url),30000);
}
function downloadFullJson(value,filename){
 downloadBlob(new Blob([JSON.stringify(value,null,2)],{type:'application/json'}),filename);
}
function archiveItems(record,prefix=''){
 const items=[{name:prefix+'request.json',data:JSON.stringify(exportApiRequestBody(record),null,2)}];
 if(record.response?.parsed)items.push({name:prefix+'response.json',
  data:JSON.stringify(exportApiResponseJson(record),null,2)});
 // The diagnostic includes the actual full SSE/wire payload, timing and
 // validation information, not just a screenshot of the final choices.
 items.push({name:prefix+'diagnostic.json',
  data:JSON.stringify(exportApiExchangeDiagnostic(record),null,2)});
 return items;
}
function archiveFolder(record,index){
 const date=String(record.startedAt||'undated').replace(/[^0-9TZ]/g,'-').slice(0,30);
 const id=String(record.id||index).replace(/[^A-Za-z0-9_-]/g,'_');
 return String(index+1).padStart(3,'0')+'-'+date+'-'+id+'/';
}
async function downloadExchangeArchive(record){
 const full=await loadFullRecord(record);
 const blob=await createZipArchive(archiveItems(full));
 const id=String(record.id).replace(/[^A-Za-z0-9_-]/g,'_');
 downloadBlob(blob,'Korean-Web-Annotator-API-'+id+'.zip');
}
let bulkExporting=false;
async function downloadAllExchangeArchives(){
 if(bulkExporting)return;
 bulkExporting=true;
 const button=$('downloadFullRequestZip');
 button.disabled=true;
 try{
  const data=await chrome.storage.local.get([LOG_FULL_INDEX_KEY,LOG_FULL_KEY]);
  const records=Array.isArray(data[LOG_FULL_INDEX_KEY])?data[LOG_FULL_INDEX_KEY]:
    Array.isArray(data[LOG_FULL_KEY])?data[LOG_FULL_KEY]:[];
  if(!records.length)throw Error(t('zipEmpty'));
  const entries=[{name:'index.json',data:JSON.stringify({format:'kra-api-exchanges-zip-v1',
   createdAt:new Date().toISOString(),total:records.length,
   exchanges:records.map((r,i)=>({folder:archiveFolder(r,i),...r}))},null,2)}];
  for(let i=0;i<records.length;i++){
   report(t('packing')+' '+(i+1)+'/'+records.length);
   const full=await loadFullRecord(records[i]);
   entries.push(...archiveItems(full,archiveFolder(records[i],i)));
  }
  report(t('packing')+' ZIP...');
  const zip=await createZipArchive(entries);
  downloadBlob(zip,'Korean-Web-Annotator-API-all-'+new Date().toISOString().replace(/[:.]/g,'-')+'.zip');
  report(t('zipDone')+' '+records.length);
 }finally{
  button.disabled=false;bulkExporting=false;
 }
}
async function loadFullRecord(record){
 if(record?.body)return record; // Older in-place full record.
 const key=fullLogStorageKey(record.id);
 const data=await chrome.storage.local.get(key);
 if(!data[key])throw Error(t('responseMissing'));
 return data[key];
}
function renderRecentFullLogs(records){
 const root=$('recentRequestLogs');if(!root)return;
 root.replaceChildren();
 for(const [index,record] of records.slice().reverse().entries()){
  if(!record||typeof record!=='object')continue;
  const row=document.createElement('div');row.className='request-log-full-row';
  const description=document.createElement('span');
  description.textContent=[record.startedAt||'',record.model||'',record.state||'',record.targets!=null?`${record.targets} targets`:'',record.attempt!=null?`attempt ${record.attempt}`:''].filter(Boolean).join(' · ');
  row.append(description);
  const fileId=String(record.id||index).replace(/[^A-Za-z0-9_-]/g,'_');
  const request=document.createElement('button');request.type='button';request.textContent=t('request');
  request.addEventListener('click',async()=>{try{downloadFullJson(exportApiRequestBody(await loadFullRecord(record)),`Korean-Web-Annotator-API-request-${fileId}.json`);}catch(error){report(error.message);}});
  row.append(request);
  const response=document.createElement('button');response.type='button';response.textContent=t('response');
  response.disabled=record.state==='started'||record.state==='error'||(record.body&&!record.response?.parsed);
  if(response.disabled)response.title=record.state==='started'?t('responsePending'):t('responseMissing');
  response.addEventListener('click',async()=>{try{downloadFullJson(exportApiResponseJson(await loadFullRecord(record)),`Korean-Web-Annotator-API-response-${fileId}.json`);}catch(error){report(error.message);}});
  row.append(response);
  const debug=document.createElement('button');debug.type='button';debug.textContent=t('debug');
  debug.addEventListener('click',async()=>{try{downloadFullJson(exportApiExchangeDiagnostic(await loadFullRecord(record)),`Korean-Web-Annotator-API-debug-${fileId}.json`);}catch(error){report(error.message);}});
  row.append(debug);
  const zip=document.createElement('button');zip.type='button';zip.textContent=t('zipOne');
  zip.addEventListener('click',async()=>{zip.disabled=true;try{await downloadExchangeArchive(record);}catch(error){report(error.message);}finally{zip.disabled=false;}});
  row.append(zip);
  const remove=document.createElement('button');remove.type='button';remove.className='request-log-delete';remove.textContent=t('remove');
  remove.addEventListener('click',async()=>{try{const result=await chrome.runtime.sendMessage({type:'DELETE_MODEL_REQUEST_LOG_ENTRY',id:record.id});if(!result?.ok)throw Error(result?.error||'Delete failed');await refresh();report(t('deleted'));}catch(error){report(error.message);}});
  row.append(remove);root.append(row);
 }
}
async function refresh(){
 const data=await chrome.storage.local.get(['progressiveAnnotation',LOG_ENABLED_KEY,LOG_KEY,LOG_FULL_INDEX_KEY,LOG_FULL_LIMIT_KEY,LOG_FULL_KEY]);
 $('progressiveAnnotation').checked=data.progressiveAnnotation===true;
 $('requestLoggingEnabled').checked=data[LOG_ENABLED_KEY]===true;
 const records=Array.isArray(data[LOG_FULL_INDEX_KEY])?data[LOG_FULL_INDEX_KEY]:Array.isArray(data[LOG_FULL_KEY])?data[LOG_FULL_KEY]:[];
 $('requestLogCount').textContent=t('count')(records.length);
 $('requestFullLogLimit').value=Number.isInteger(data[LOG_FULL_LIMIT_KEY])?data[LOG_FULL_LIMIT_KEY]:FULL_RECORD_LIMIT;
 renderRecentFullLogs(records);
}
const report=message=>{$('featureStatus').textContent=message;};
for(const key of ['progressiveAnnotation',LOG_ENABLED_KEY])$(key).addEventListener('change',async()=>{try{await chrome.storage.local.set({[key]:$(key).checked});report(t('saved'));}catch(e){report(e.message);await refresh();}});
$('requestFullLogLimit').addEventListener('change',async()=>{try{
 const n=Number($('requestFullLogLimit').value);
 if(!Number.isSafeInteger(n)||n<1||n>MAX_FULL_RECORD_LIMIT)throw Error(t('badLimit'));
 const result=await chrome.runtime.sendMessage({type:'SET_MODEL_REQUEST_LOG_LIMIT',limit:n});
 if(!result?.ok)throw Error(result?.error||t('badLimit'));
 await refresh();report(t('saved'));
 }catch(error){report(error.message);await refresh();}});
$('downloadFullRequestZip').addEventListener('click',async()=>{try{await downloadAllExchangeArchives();}catch(e){report(e.message);}});
$('downloadRequestLogs').addEventListener('click',async()=>{try{
 const data=await chrome.storage.local.get(LOG_KEY),records=Array.isArray(data[LOG_KEY])?data[LOG_KEY]:[];if(!records.length){report(t('empty'));return;}
 const exportedAt=new Date().toISOString(),version=chrome.runtime.getManifest().version;
 const blob=new Blob([JSON.stringify({format:'kra-model-request-logs-v1',extensionVersion:version,exportedAt,note:'Credentials are redacted. Raw responses may include reasoning and submitted page text. state=started means no final outcome was recorded. Truncated records are marked.',records},null,2)],{type:'application/json'});
 const url=URL.createObjectURL(blob),anchor=document.createElement('a');anchor.href=url;anchor.download=`Korean-Web-Annotator-requests-${exportedAt.replace(/[:.]/g,'-')}.json`;document.body.append(anchor);anchor.click();anchor.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);report(t('exported'));
 }catch(e){report(e.message);}});
$('clearRequestLogs').addEventListener('click',async()=>{try{const result=await chrome.runtime.sendMessage({type:'CLEAR_MODEL_REQUEST_LOGS'});if(!result?.ok)throw Error(result?.error||'Unable to clear request logs');await refresh();report(t('cleared'));}catch(e){report(e.message);}});
$('uiLocale').addEventListener('change',()=>{translate();refresh().catch(e=>report(e.message));});
chrome.storage.onChanged.addListener((changes,area)=>{if(area==='local'&&(changes[LOG_KEY]||changes[LOG_FULL_KEY]||changes[LOG_FULL_INDEX_KEY]||changes[LOG_FULL_LIMIT_KEY]||changes[LOG_ENABLED_KEY]||changes.progressiveAnnotation))refresh().catch(e=>report(e.message));});
translate();refresh().catch(e=>report(e.message));
