const CONTENT_SCRIPT_VERSION = '1.0.2';
const FIXED_CONCURRENCY = 4;
const uiLocale = document.querySelector('#uiLocale');
const hanjaMode = document.querySelector('#hanjaMode');
const loanwordMode = document.querySelector('#loanwordMode');
const copyModes=Array.from(document.querySelectorAll('input[name=copyMode]'));
const selectedCopyMode=()=>copyModes.find(input=>input.checked)?.value||'hangul';
const reviewSelectionButton=document.querySelector('#reviewSelectionButton');
const forceRegenerate = document.querySelector('#forceRegenerate');
const stopAutoAfterPageComplete=document.querySelector('#stopAutoAfterPageComplete');
const clearCacheOnExit=document.querySelector('#clearCacheOnExit');
const toolbarHangulOnly=document.querySelector('#toolbarHangulOnly');
const toolbarDisplay = document.querySelector('#toolbarDisplay');
const mobileSelectionToolbar = document.querySelector('#mobileSelectionToolbar');
const selectionButton = document.querySelector('#selectionButton');
const runButton = document.querySelector('#runButton');
const undoButton = document.querySelector('#undoButton');
const restoreButton = document.querySelector('#restoreButton');
const clearCacheButton = document.querySelector('#clearCacheButton');
const optionsButton = document.querySelector('#optionsButton');
const status = document.querySelector('#status');

const STRINGS = {
  'zh-CN': {
    title:'韩语汉字·外来语标注', hanjaMode:'汉字词：正文显示汉字，原谚文显示在正上方', loanwordMode:'外来语：在韩文正上方显示原词', copyAnnotation:'只复制上方标注', copyLegend:'复制标注文字时', copyBase:'只复制当前显示的正文', copyAnnotated:'复制正文和标注', copyHangul:'只复制原韩语（谚文）', forceRegenerate:'本次忽略缓存，重新分析词典', mobileToolbar:'启用网页工具条', annotateSelection:'标注所选文字', annotatePage:'一键标注整页', undo:'撤销上次标注', restore:'还原全部', clearCache:'清除标注缓存', apiSettings:'引擎 / API 设置', chooseMode:'请至少启用一种标注。', noSelection:'无法读取当前选区。', selectionStarted:'已开始标注所选文字。', pageStarted:'已开始处理整页。', noUndo:'没有可以撤销的标注。', undoDone:'已撤销最近一次标注。', restored:'已还原当前网页的全部标注。', cacheFailed:'无法清除标注缓存。', cacheCleared:'标注缓存已清除。', copyApplied:'复制模式已实时应用。', copySaved:'设置已保存；当前页面不允许扩展注入。', noTab:'没有找到当前标签页。', scriptFailed:'内容脚本没有正确启动，请刷新当前网页后重试。', apiNotReady:'API 尚未配置或当前会话中的 API Key 不可用，请打开 引擎 / API 设置检查。'
  },
  'zh-TW': {
    title:'韓語漢字·外來語標註', hanjaMode:'漢字詞：正文顯示漢字，原諺文顯示在正上方', loanwordMode:'外來語：在韓文正上方顯示原詞', copyAnnotation:'只複製上方標註', copyLegend:'複製標註文字時', copyBase:'只複製目前顯示的正文', copyAnnotated:'複製正文和標註', copyHangul:'只複製原韓語（諺文）', forceRegenerate:'本次忽略快取，重新分析詞典', mobileToolbar:'觸控裝置：選取韓文後顯示浮動操作列', annotateSelection:'標註所選文字', annotatePage:'一鍵標註整頁', undo:'復原上次標註', restore:'還原全部', clearCache:'清除標註快取', apiSettings:'引擎 / API 設定', chooseMode:'請至少啟用一種標註。', noSelection:'無法讀取目前選取內容。', selectionStarted:'已開始標註所選文字。', pageStarted:'已開始處理整頁。', noUndo:'沒有可以復原的標註。', undoDone:'已復原最近一次標註。', restored:'已還原目前網頁的全部標註。', cacheFailed:'無法清除標註快取。', cacheCleared:'標註快取已清除。', copyApplied:'複製模式已即時套用。', copySaved:'設定已儲存；目前頁面不允許擴充功能注入。', noTab:'找不到目前分頁。', scriptFailed:'內容腳本未正確啟動，請重新整理目前網頁後再試。', apiNotReady:'API 尚未設定或目前工作階段中的 API Key 不可用，請開啟 引擎 / API 設定檢查。'
  },
  ja: {
    title:'韓国語 漢字・外来語注釈', hanjaMode:'漢字語：本文は漢字で表示し、元のハングルを真上に表示する', loanwordMode:'外来語：ハングルの真上に原語を表示する', copyAnnotation:'上の注釈のみコピー', copyLegend:'注釈付き文字をコピーするとき', copyBase:'現在表示されている本文のみコピー', copyAnnotated:'本文と注釈をコピー', copyHangul:'元の韓国語（ハングル）のみコピー', forceRegenerate:'今回はキャッシュを無視して辞書を再解析', mobileToolbar:'タッチ端末：韓国語を選択したらフローティング操作バーを表示', annotateSelection:'選択範囲を注釈', annotatePage:'ページ全体を注釈', undo:'直前の注釈を元に戻す', restore:'すべて元に戻す', clearCache:'注釈キャッシュを消去', apiSettings:'引擎 / API 設定', chooseMode:'少なくとも1種類の注釈を有効にしてください。', noSelection:'現在の選択範囲を読み取れません。', selectionStarted:'選択範囲の注釈を開始しました。', pageStarted:'ページ全体の処理を開始しました。', noUndo:'元に戻せる注釈がありません。', undoDone:'直前の注釈を元に戻しました。', restored:'このページの注釈をすべて元に戻しました。', cacheFailed:'注釈キャッシュを消去できません。', cacheCleared:'注釈キャッシュを消去しました。', copyApplied:'コピー設定をすぐに適用しました。', copySaved:'設定を保存しました。現在のページには拡張機能を挿入できません。', noTab:'現在のタブが見つかりません。', scriptFailed:'コンテンツスクリプトを起動できませんでした。ページを再読み込みしてください。', apiNotReady:'API が未設定、または現在のセッションで API Key を利用できません。引擎 / API 設定を確認してください。'
  },
  ko: {
    title:'한국어 한자·외래어 주석', hanjaMode:'한자어: 본문은 한자로 표시하고 원래 한글은 바로 위에 표시', loanwordMode:'외래어: 한글 바로 위에 원어 표시', copyAnnotation:'위 주석만 복사', copyLegend:'주석된 텍스트를 복사할 때', copyBase:'현재 보이는 본문만 복사', copyAnnotated:'본문과 주석 복사', copyHangul:'원래 한국어(한글)만 복사', forceRegenerate:'이번에는 캐시를 무시하고 사전 다시 분석', mobileToolbar:'터치 기기: 한국어 선택 후 플로팅 작업 표시줄 표시', annotateSelection:'선택 영역 주석', annotatePage:'페이지 전체 주석', undo:'마지막 주석 실행 취소', restore:'모두 복원', clearCache:'주석 캐시 지우기', apiSettings:'엔진 / API 설정', chooseMode:'주석 유형을 하나 이상 활성화하세요.', noSelection:'현재 선택 영역을 읽을 수 없습니다.', selectionStarted:'선택 영역 주석을 시작했습니다.', pageStarted:'페이지 전체 처리를 시작했습니다.', noUndo:'실행 취소할 주석이 없습니다.', undoDone:'마지막 주석을 취소했습니다.', restored:'현재 페이지의 모든 주석을 복원했습니다.', cacheFailed:'주석 캐시를 지울 수 없습니다.', cacheCleared:'주석 캐시를 지웠습니다.', copyApplied:'복사 설정을 즉시 적용했습니다.', copySaved:'설정을 저장했습니다. 현재 페이지에는 확장 프로그램을 삽입할 수 없습니다.', noTab:'현재 탭을 찾을 수 없습니다.', scriptFailed:'콘텐츠 스크립트가 시작되지 않았습니다. 페이지를 새로고침하세요.', apiNotReady:'API가 설정되지 않았거나 현재 세션에서 API Key를 사용할 수 없습니다. 엔진 / API 설정을 확인하세요.'
  },
  en: {
    title:'Korean Hanja & Loanword Annotator', hanjaMode:'Hanja words: show Hanja in the main text and the original Hangul directly above', loanwordMode:'Loanwords: show the source word directly above the Hangul', copyAnnotation:'Copy annotation only', copyLegend:'When copying annotated text', copyBase:'Copy the currently displayed main text only', copyAnnotated:'Copy main text and annotations', copyHangul:'Copy original Korean (Hangul) only', forceRegenerate:'Ignore cache and analyze the dictionary again', mobileToolbar:'Touch devices: show a floating toolbar after selecting Korean text', annotateSelection:'Annotate selection', annotatePage:'Annotate page', undo:'Undo last annotation', restore:'Restore all', clearCache:'Clear annotation cache', apiSettings:'Engine / API settings', chooseMode:'Enable at least one annotation type.', noSelection:'Could not read the current selection.', selectionStarted:'Started annotating the selected text.', pageStarted:'Started processing the page.', noUndo:'There is no annotation to undo.', undoDone:'Undid the most recent annotation.', restored:'Restored all annotations on this page.', cacheFailed:'Could not clear the annotation cache.', cacheCleared:'Annotation cache cleared.', copyApplied:'Copy settings applied immediately.', copySaved:'Settings saved; this page does not allow extension injection.', noTab:'Could not find the active tab.', scriptFailed:'The content script did not start correctly. Reload the page and try again.', apiNotReady:'The API is not configured or the API Key is unavailable in this browser session. Check Engine / API settings.'
  }
};

let locale = 'zh-CN';
const t = key => STRINGS[locale]?.[key] || STRINGS.en[key] || key;

init().catch(showError);
let pageStartPending=false;

async function init() {
  const { uiSettings: stored = {} } = await chrome.storage.local.get('uiSettings');
  const uiSettings = removeLegacyUiSettings(stored);
  locale = normalizeLocale(uiSettings.uiLocale);
  uiLocale.value = locale;
  applyLocale();
  hanjaMode.checked = uiSettings.hanjaMode ?? true;
  loanwordMode.checked = uiSettings.loanwordMode ?? true;
  for(const input of copyModes)input.checked=input.value===uiSettings.copyMode;
  forceRegenerate.checked = false;
  mobileSelectionToolbar.checked = uiSettings.mobileSelectionToolbar ?? true;
  stopAutoAfterPageComplete.checked=uiSettings.stopAutoAfterPageComplete ?? true;
  clearCacheOnExit.checked=uiSettings.clearCacheOnExit ?? true;
  toolbarHangulOnly.checked=uiSettings.toolbarHangulOnly ?? true;
  toolbarDisplay.value=uiSettings.toolbarDisplay==='always'?'always':'selection';
  // Loading the popup must not inject scripts or warm up the engine.
}

uiLocale.addEventListener('change', async () => {
  locale = normalizeLocale(uiLocale.value);
  applyLocale();
  const { uiSettings: stored = {} } = await chrome.storage.local.get('uiSettings');
  const next = { ...removeLegacyUiSettings(stored), uiLocale: locale };
  await chrome.storage.local.set({ uiSettings: next });
  await applyUiSettingsToActivePage(next);
  chrome.runtime.sendMessage({ type: 'REFRESH_CONTEXT_MENU' }).catch(() => {});
});

for (const input of [...copyModes, hanjaMode, loanwordMode, mobileSelectionToolbar, toolbarDisplay, stopAutoAfterPageComplete, clearCacheOnExit, toolbarHangulOnly]) {
  input.addEventListener('change', persistNonCopySettings);
}

async function persistNonCopySettings() {
  const { uiSettings: stored = {} } = await chrome.storage.local.get('uiSettings');
  const next = {
    ...removeLegacyUiSettings(stored),
    copyMode:selectedCopyMode(),
    hanjaMode: hanjaMode.checked,
    loanwordMode: loanwordMode.checked,
    mobileSelectionToolbar: mobileSelectionToolbar.checked, toolbarDisplay:toolbarDisplay.value, toolbarHangulOnly:toolbarHangulOnly.checked, stopAutoAfterPageComplete:stopAutoAfterPageComplete.checked, clearCacheOnExit:clearCacheOnExit.checked,
    uiLocale: locale
  };
  await chrome.storage.local.set({ uiSettings: next });
  await applyUiSettingsToActivePage(next);
}

selectionButton.addEventListener('click', async () => {
  try {
    const settings = await saveAndGetRunSettings();
    const tab = await getActiveTab();
    await ensureContentScript(tab.id);
    const response = await chrome.tabs.sendMessage(tab.id, { type: 'START_SELECTION_ANNOTATION', ...settings });
    if (!response?.ok) throw new Error(response?.error || t('noSelection'));
    status.textContent = t('selectionStarted');
  } catch (error) { showError(error); }
});

reviewSelectionButton.addEventListener('click',async()=>{
 try{const settings=await saveAndGetRunSettings();const tab=await getActiveTab();await ensureContentScript(tab.id);const response=await chrome.tabs.sendMessage(tab.id,{type:'START_SELECTION_ANNOTATION',...settings,forceRegenerate:true,reviewAll:true});if(!response?.ok)throw Error(response?.error||t('noSelection'));status.textContent='已开始模型重审选区。';}catch(error){showError(error);}
});

runButton.addEventListener('click', async () => {
  if(pageStartPending)return;
  pageStartPending=true;runButton.disabled=true;status.textContent='正在启动整页标注…';
  try {
    const modes={hanja:hanjaMode.checked,loanword:loanwordMode.checked};
    if(!modes.hanja&&!modes.loanword)throw new Error(t('chooseMode'));
    // Transfer ownership before awaiting storage, script checks or engine work.
    const response=await chrome.runtime.sendMessage({
      type:'KRA_START_PAGE_FROM_POPUP',modes,deepAnalysis:true,
      requestConcurrency:FIXED_CONCURRENCY,forceRegenerate:forceRegenerate.checked,
      uiSettings:currentUiSettings()
    });
    if(!response?.ok)throw new Error(response?.error||t('scriptFailed'));
    status.textContent=response.started===false?'没有未标注的韩语文字。':t('pageStarted');
  } catch(error){showError(error);}
  finally{pageStartPending=false;runButton.disabled=false;}
});

function currentUiSettings(){
  return {hanjaMode:hanjaMode.checked,loanwordMode:loanwordMode.checked,
    copyMode:selectedCopyMode(),deepAnalysis:true,mobileSelectionToolbar:mobileSelectionToolbar.checked,
    toolbarDisplay:toolbarDisplay.value,toolbarHangulOnly:toolbarHangulOnly.checked,
    stopAutoAfterPageComplete:stopAutoAfterPageComplete.checked,clearCacheOnExit:clearCacheOnExit.checked,uiLocale:locale};
}

undoButton.addEventListener('click', async () => {
  try {
    const tab = await getActiveTab();
    await ensureContentScript(tab.id);
    const response = await chrome.tabs.sendMessage(tab.id, { type: 'UNDO_LAST_ANNOTATION' });
    if (!response?.ok) throw new Error(response?.error || t('noUndo'));
    status.textContent = t('undoDone');
  } catch (error) { showError(error); }
});

restoreButton.addEventListener('click', async () => {
  try {
    const tab = await getActiveTab();
    await ensureContentScript(tab.id);
    await chrome.tabs.sendMessage(tab.id, { type: 'RESTORE_ANNOTATION' });
    status.textContent = t('restored');
  } catch (error) { showError(error); }
});

clearCacheButton.addEventListener('click', async () => {
  try {
    const response = await chrome.runtime.sendMessage({ type: 'CLEAR_ANNOTATION_CACHE' });
    if (!response?.ok) throw new Error(response?.error || t('cacheFailed'));
    status.textContent = t('cacheCleared');
  } catch (error) { showError(error); }
});

optionsButton.addEventListener('click', () => chrome.runtime.openOptionsPage());

async function saveAndGetRunSettings() {
  const modes = { hanja: hanjaMode.checked, loanword: loanwordMode.checked };
  if (!modes.hanja && !modes.loanword) throw new Error(t('chooseMode'));
  const settings = { modes, deepAnalysis: true, requestConcurrency: FIXED_CONCURRENCY, forceRegenerate: forceRegenerate.checked };
  const nextUiSettings = { hanjaMode: modes.hanja, loanwordMode: modes.loanword, copyMode:selectedCopyMode(), deepAnalysis: true, mobileSelectionToolbar: mobileSelectionToolbar.checked, toolbarDisplay:toolbarDisplay.value, toolbarHangulOnly:toolbarHangulOnly.checked, stopAutoAfterPageComplete:stopAutoAfterPageComplete.checked, clearCacheOnExit:clearCacheOnExit.checked, uiLocale: locale };
  await chrome.storage.local.set({ uiSettings: nextUiSettings });
  await applyUiSettingsToActivePage(nextUiSettings);
  const apiReady = await chrome.runtime.sendMessage({ type: 'CHECK_ENGINE_READY' });
  if (!apiReady?.ok) throw new Error(apiReady?.error || t('apiNotReady'));
  return settings;
}

function removeLegacyUiSettings(source = {}) {
  const { balanceAnnotations, highConcurrency, requestConcurrency, copyMode, copyAnnotations, ...rest } = source || {};
  return {...rest,copyMode:['base','annotated','hangul','annotation'].includes(copyMode)?copyMode:'hangul'};
}
function normalizeLocale(value) { return ['zh-CN','zh-TW','ja','ko','en'].includes(value) ? value : 'zh-CN'; }
function applyLocale() {
  document.documentElement.lang = locale;
  for (const el of document.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);
}
async function applyUiSettingsToActivePage(uiSettings) {
  try { const tab = await getActiveTab(); await ensureContentScript(tab.id); await chrome.tabs.sendMessage(tab.id,{type:'APPLY_UI_SETTINGS',uiSettings}); } catch {}
}
async function getActiveTab() { const [tab] = await chrome.tabs.query({active:true,currentWindow:true}); if (!tab?.id) throw new Error(t('noTab')); return tab; }
async function ensureContentScript(tabId) {
  try { const existing = await chrome.tabs.sendMessage(tabId,{type:'KRA_PING'}); if (existing?.ok && existing.version===CONTENT_SCRIPT_VERSION) return; } catch {}
  await chrome.scripting.insertCSS({target:{tabId},files:['content.css']});
  await chrome.scripting.executeScript({target:{tabId},files:['content.js']});
  const injected = await chrome.tabs.sendMessage(tabId,{type:'KRA_PING'});
  if (!injected?.ok || injected.version!==CONTENT_SCRIPT_VERSION) throw new Error(t('scriptFailed'));
}
function showError(error) { status.textContent = error?.message || String(error); }
