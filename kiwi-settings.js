import {kiwiAction} from './browser-engine.js';
import {UPDATE_ORIGINS} from './kiwi-package.js';
const $=id=>document.getElementById(id);
const texts={
 'zh-CN':{title:'Kiwi 引擎更新',check:'检查更新',install:'下载并启用最新版',restore:'恢复内置版本',hint:'从 Kiwi 官方发布源下载引擎和兼容模型，校验并通过分词检查后切换。下载一次后可离线使用，词源词典和设置保留。标注或手动审核期间不能切换引擎。',current:'当前',model:'模型',builtin:'内置',updated:'独立更新',latest:'上游稳定版',checking:'正在检查…',cancel:'未授权访问官方更新源，操作已取消。',done:'操作完成。',missing:'尚未检查上游版本。'},
 'zh-TW':{title:'Kiwi 引擎更新',check:'檢查更新',install:'下載並啟用最新版',restore:'恢復內建版本',hint:'從 Kiwi 官方來源下載引擎與相容模型，校驗及分詞檢查成功後切換。下載後可離線使用，保留詞源詞典與設定。標註或手動審核期間無法切換。',current:'目前',model:'模型',builtin:'內建',updated:'獨立更新',latest:'上游穩定版',checking:'正在檢查…',cancel:'未授權存取官方更新來源，已取消。',done:'操作完成。',missing:'尚未檢查上游版本。'},
 en:{title:'Kiwi engine updates',check:'Check for updates',install:'Download and activate latest',restore:'Restore bundled version',hint:'Download the engine and matching models from official Kiwi sources. Activate after integrity and tokenization checks. Works offline after download; keeps your origin dictionary and settings. Finish or cancel annotation/manual review before switching.',current:'Current',model:'Model',builtin:'Bundled',updated:'Independent update',latest:'Upstream stable',checking:'Checking…',cancel:'Official update-source access was not granted. Cancelled.',done:'Completed.',missing:'Upstream version not checked.'},
 ja:{title:'Kiwiエンジン更新',check:'更新を確認',install:'最新版を取得して有効化',restore:'内蔵版に戻す',hint:'Kiwi公式配布元からエンジンと対応モデルを取得し、検証後に切り替えます。取得後はオフライン利用可能。辞書と設定は保持します。処理・手動審査中は切り替えできません。',current:'現在',model:'モデル',builtin:'内蔵',updated:'個別更新',latest:'公式安定版',checking:'確認中…',cancel:'公式更新元へのアクセスが許可されませんでした。',done:'完了しました。',missing:'最新版は未確認です。'},
 ko:{title:'Kiwi 엔진 업데이트',check:'업데이트 확인',install:'최신 버전 다운로드 및 사용',restore:'내장 버전 복원',hint:'Kiwi 공식 배포처에서 엔진과 호환 모델을 받아 검증 후 전환합니다. 다운로드 후 오프라인 사용 가능하며 사전과 설정은 유지됩니다. 주석 및 수동 검토 작업 중에는 전환할 수 없습니다.',current:'현재',model:'모델',builtin:'내장',updated:'개별 업데이트',latest:'공식 안정 버전',checking:'확인 중…',cancel:'공식 업데이트 출처 접근이 허용되지 않아 취소했습니다.',done:'완료했습니다.',missing:'최신 버전을 아직 확인하지 않았습니다.'}
};
let state,busy=false;
const copy=()=>texts[$('uiLocale')?.value]||texts.en;
function render(){
 const t=copy();for(const [id,key]of Object.entries({kiwiUpdateHeading:'title',kiwiCheckUpdate:'check',kiwiInstallUpdate:'install',kiwiRestoreBuiltin:'restore',kiwiUpdateHint:'hint'}))$(id).textContent=t[key];
 $('kiwiRuntimeSummary').textContent=state?.current?`${t.current}：Kiwi ${state.current.version} · ${t.model} ${state.current.modelVersion} · ${t[state.current.source]}`:'';
 $('kiwiLatestSummary').textContent=state?.latest?`${t.latest}：Kiwi ${state.latest.engine.version} · ${t.model} ${state.latest.model.version}`:t.missing;
 $('kiwiCheckUpdate').disabled=busy;$('kiwiInstallUpdate').disabled=busy||!state?.latest||state.latest.engine.version===state.current.version;$('kiwiRestoreBuiltin').disabled=busy||state?.current?.source!=='updated';
}
async function run(action,needsNetwork){
 if(busy)return;busy=true;render();$('kiwiUpdateProgress').hidden=false;$('kiwiUpdateProgress').removeAttribute('value');$('kiwiUpdateStatus').textContent=copy().checking;
 try{
  // Request on the click gesture, before the first await.
  if(needsNetwork&&!await chrome.permissions.request({origins:UPDATE_ORIGINS}))throw Error(copy().cancel);
  state=await kiwiAction(action);$('kiwiUpdateStatus').textContent=state.lastError||copy().done;
 }catch(error){$('kiwiUpdateStatus').textContent=String(error.message||error);}
 finally{busy=false;$('kiwiUpdateProgress').hidden=true;render();}
}
$('kiwiCheckUpdate').addEventListener('click',()=>run('check',true));$('kiwiInstallUpdate').addEventListener('click',()=>run('install',true));$('kiwiRestoreBuiltin').addEventListener('click',()=>run('restore',false));
$('uiLocale')?.addEventListener('change',render);
chrome.storage.onChanged.addListener((changes,area)=>{const p=changes.kiwiUpdateProgress?.newValue;if(area!=='local'||!p||!busy)return;$('kiwiUpdateStatus').textContent=p.message;const bar=$('kiwiUpdateProgress');if(p.total){bar.max=p.total;bar.value=p.loaded;}else bar.removeAttribute('value');});
kiwiAction('status').then(s=>{state=s;render();if(s.lastError)$('kiwiUpdateStatus').textContent=s.lastError;}).catch(e=>{$('kiwiUpdateStatus').textContent=e.message;});render();
