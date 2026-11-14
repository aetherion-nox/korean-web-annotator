const CONTENT_SCRIPT_VERSION = '1.1.56.16-proper-name-experimental-origins';
const FIXED_CONCURRENCY = 4;
const uiLocale = document.querySelector('#uiLocale');
const hanjaMode = document.querySelector('#hanjaMode');
const loanwordMode = document.querySelector('#loanwordMode');
const copyModes=Array.from(document.querySelectorAll('input[name=copyMode]'));
const selectedCopyMode=()=>copyModes.find(input=>input.checked)?.value||'hangul';
const reviewSelectionButton=document.querySelector('#reviewSelectionButton');
const forceRegenerate = document.querySelector('#forceRegenerate');
const stopAutoAfterPageComplete=document.querySelector('#stopAutoAfterPageComplete');
const restoreExistingAnnotations=document.querySelector('#restoreExistingAnnotations');
const hideToolbarOnFirstManual=document.querySelector('#hideToolbarOnFirstManual');
const clearCacheOnExit=document.querySelector('#clearCacheOnExit');
const toolbarHangulOnly=document.querySelector('#toolbarHangulOnly');
const toolbarDisplay = document.querySelector('#toolbarDisplay');
const mobileSelectionToolbar = document.querySelector('#mobileSelectionToolbar');
const floatingBallEnabled = document.querySelector('#floatingBallEnabled');
const toolbarBallOnly = document.querySelector('#toolbarBallOnly');
const selectionButton = document.querySelector('#selectionButton');
const runButton = document.querySelector('#runButton');
const undoButton = document.querySelector('#undoButton');
const redoButton = document.querySelector('#redoButton');
const historySteps=document.querySelector('#historySteps');
const restoreButton = document.querySelector('#restoreButton');
const clearCacheButton = document.querySelector('#clearCacheButton');
const optionsButton = document.querySelector('#optionsButton');
const status = document.querySelector('#status');

const STRINGS = {
  'zh-CN': { floatingBall:'可拖动悬浮球（点击打开工具条）',
    restoreExistingAnnotations:'动态网页兼容：恢复已有标注', recoveryHint:'网页重绘后复用已有结果补回标注，不重新调用模型；与停止自动标注分开控制。',
    title:'韩语汉字·外来语标注', hanjaMode:'汉字词：正文显示汉字，原谚文显示在正上方', loanwordMode:'外来语：在韩文正上方显示原词', copyAnnotation:'只复制上方标注', copyLegend:'复制标注文字时', copyBase:'只复制当前显示的正文', copyAnnotated:'复制正文和标注', copyHangul:'只复制原韩语（谚文）', forceRegenerate:'本次忽略缓存，重新分析文本', mobileToolbar:'启用网页工具条', annotateSelection:'标注所选文字', annotatePage:'一键标注整页', undo:'撤销上次标注', restore:'还原全部', clearCache:'清除标注缓存', apiSettings:'引擎 / API 设置', chooseMode:'请至少启用一种标注。', noSelection:'无法读取当前选区。', selectionStarted:'已开始标注所选文字。', pageStarted:'已开始处理整页。', noUndo:'没有可以撤销的标注。', undoDone:'已撤销最近一次标注。', restored:'已还原当前网页的全部标注。', cacheFailed:'无法清除标注缓存。', cacheCleared:'标注缓存已清除。', copyApplied:'复制模式已实时应用。', copySaved:'设置已保存；当前页面不允许扩展注入。', noTab:'没有找到当前标签页。', scriptFailed:'内容脚本没有正确启动，请刷新当前网页后重试。', apiNotReady:'API 尚未配置或当前会话中的 API Key 不可用，请打开 引擎 / API 设置检查。'
  },
  'zh-TW': { floatingBall:'可拖曳浮動球（點擊開啟工具列）',
    restoreExistingAnnotations:'動態網頁相容：恢復已有標註', recoveryHint:'網頁重繪後重用已有結果補回標註，不重新呼叫模型；與停止自動標註分開控制。',
    title:'韓語漢字·外來語標註', hanjaMode:'漢字詞：正文顯示漢字，原諺文顯示在正上方', loanwordMode:'外來語：在韓文正上方顯示原詞', copyAnnotation:'只複製上方標註', copyLegend:'複製標註文字時', copyBase:'只複製目前顯示的正文', copyAnnotated:'複製正文和標註', copyHangul:'只複製原韓語（諺文）', forceRegenerate:'本次忽略快取，重新分析文字', mobileToolbar:'觸控裝置：選取韓文後顯示浮動操作列', annotateSelection:'標註所選文字', annotatePage:'一鍵標註整頁', undo:'復原上次標註', restore:'還原全部', clearCache:'清除標註快取', apiSettings:'引擎 / API 設定', chooseMode:'請至少啟用一種標註。', noSelection:'無法讀取目前選取內容。', selectionStarted:'已開始標註所選文字。', pageStarted:'已開始處理整頁。', noUndo:'沒有可以復原的標註。', undoDone:'已復原最近一次標註。', restored:'已還原目前網頁的全部標註。', cacheFailed:'無法清除標註快取。', cacheCleared:'標註快取已清除。', copyApplied:'複製模式已即時套用。', copySaved:'設定已儲存；目前頁面不允許擴充功能注入。', noTab:'找不到目前分頁。', scriptFailed:'內容腳本未正確啟動，請重新整理目前網頁後再試。', apiNotReady:'API 尚未設定或目前工作階段中的 API Key 不可用，請開啟 引擎 / API 設定檢查。'
  },
  ja: { floatingBall:'移動できるフローティングボタン',
    restoreExistingAnnotations:'動的ページ対応：既存の注釈を復元', recoveryHint:'ページ再描画後に既存の結果を再表示します。モデルへの再リクエストは行いません。',
    title:'韓国語 漢字・外来語注釈', hanjaMode:'漢字語：本文は漢字で表示し、元のハングルを真上に表示する', loanwordMode:'外来語：ハングルの真上に原語を表示する', copyAnnotation:'上の注釈のみコピー', copyLegend:'注釈付き文字をコピーするとき', copyBase:'現在表示されている本文のみコピー', copyAnnotated:'本文と注釈をコピー', copyHangul:'元の韓国語（ハングル）のみコピー', forceRegenerate:'今回はキャッシュを無視してテキストを再解析', mobileToolbar:'タッチ端末：韓国語を選択したらフローティング操作バーを表示', annotateSelection:'選択範囲を注釈', annotatePage:'ページ全体を注釈', undo:'直前の注釈を元に戻す', restore:'すべて元に戻す', clearCache:'注釈キャッシュを消去', apiSettings:'引擎 / API 設定', chooseMode:'少なくとも1種類の注釈を有効にしてください。', noSelection:'現在の選択範囲を読み取れません。', selectionStarted:'選択範囲の注釈を開始しました。', pageStarted:'ページ全体の処理を開始しました。', noUndo:'元に戻せる注釈がありません。', undoDone:'直前の注釈を元に戻しました。', restored:'このページの注釈をすべて元に戻しました。', cacheFailed:'注釈キャッシュを消去できません。', cacheCleared:'注釈キャッシュを消去しました。', copyApplied:'コピー設定をすぐに適用しました。', copySaved:'設定を保存しました。現在のページには拡張機能を挿入できません。', noTab:'現在のタブが見つかりません。', scriptFailed:'コンテンツスクリプトを起動できませんでした。ページを再読み込みしてください。', apiNotReady:'API が未設定、または現在のセッションで API Key を利用できません。引擎 / API 設定を確認してください。'
  },
  ko: { floatingBall:'이동 가능한 플로팅 버튼',
    restoreExistingAnnotations:'동적 웹페이지 호환: 기존 주석 복구', recoveryHint:'페이지가 다시 그려지면 기존 결과로 주석을 복구합니다. 모델에 다시 요청하지 않습니다.',
    title:'한국어 한자·외래어 주석', hanjaMode:'한자어: 본문은 한자로 표시하고 원래 한글은 바로 위에 표시', loanwordMode:'외래어: 한글 바로 위에 원어 표시', copyAnnotation:'위 주석만 복사', copyLegend:'주석된 텍스트를 복사할 때', copyBase:'현재 보이는 본문만 복사', copyAnnotated:'본문과 주석 복사', copyHangul:'원래 한국어(한글)만 복사', forceRegenerate:'이번에는 캐시를 무시하고 텍스트 다시 분석', mobileToolbar:'터치 기기: 한국어 선택 후 플로팅 작업 표시줄 표시', annotateSelection:'선택 영역 주석', annotatePage:'페이지 전체 주석', undo:'마지막 주석 실행 취소', restore:'모두 복원', clearCache:'주석 캐시 지우기', apiSettings:'엔진 / API 설정', chooseMode:'주석 유형을 하나 이상 활성화하세요.', noSelection:'현재 선택 영역을 읽을 수 없습니다.', selectionStarted:'선택 영역 주석을 시작했습니다.', pageStarted:'페이지 전체 처리를 시작했습니다.', noUndo:'실행 취소할 주석이 없습니다.', undoDone:'마지막 주석을 취소했습니다.', restored:'현재 페이지의 모든 주석을 복원했습니다.', cacheFailed:'주석 캐시를 지울 수 없습니다.', cacheCleared:'주석 캐시를 지웠습니다.', copyApplied:'복사 설정을 즉시 적용했습니다.', copySaved:'설정을 저장했습니다. 현재 페이지에는 확장 프로그램을 삽입할 수 없습니다.', noTab:'현재 탭을 찾을 수 없습니다.', scriptFailed:'콘텐츠 스크립트가 시작되지 않았습니다. 페이지를 새로고침하세요.', apiNotReady:'API가 설정되지 않았거나 현재 세션에서 API Key를 사용할 수 없습니다. 엔진 / API 설정을 확인하세요.'
  },
  en: { floatingBall:'Draggable button: open page toolbar',
    restoreExistingAnnotations:'Dynamic pages: restore existing annotations', recoveryHint:'Restore cached annotations after page redraws without new model requests. Independent of automatic annotation.',
    title:'Korean Hanja & Loanword Annotator', hanjaMode:'Hanja words: show Hanja in the main text and the original Hangul directly above', loanwordMode:'Loanwords: show the source word directly above the Hangul', copyAnnotation:'Copy annotation only', copyLegend:'When copying annotated text', copyBase:'Copy the currently displayed main text only', copyAnnotated:'Copy main text and annotations', copyHangul:'Copy original Korean (Hangul) only', forceRegenerate:'Ignore cache and analyze the text again', mobileToolbar:'Touch devices: show a floating toolbar after selecting Korean text', annotateSelection:'Annotate selection', annotatePage:'Annotate page', undo:'Undo last annotation', restore:'Restore all', clearCache:'Clear annotation cache', apiSettings:'Engine / API settings', chooseMode:'Enable at least one annotation type.', noSelection:'Could not read the current selection.', selectionStarted:'Started annotating the selected text.', pageStarted:'Started processing the page.', noUndo:'There is no annotation to undo.', undoDone:'Undid the most recent annotation.', restored:'Restored all annotations on this page.', cacheFailed:'Could not clear the annotation cache.', cacheCleared:'Annotation cache cleared.', copyApplied:'Copy settings applied immediately.', copySaved:'Settings saved; this page does not allow extension injection.', noTab:'Could not find the active tab.', scriptFailed:'The content script did not start correctly. Reload the page and try again.', apiNotReady:'The API is not configured or the API Key is unavailable in this browser session. Check Engine / API settings.'
  }
};

for(const [lang,labels] of Object.entries({
  'zh-CN':['撤销一步','重做一步','清除全部标注','没有可重做的标注。','已重做一步标注。','撤销 {u} 步 · 重做 {r} 步'],
  'zh-TW':['復原一步','重做一步','清除全部標註','沒有可重做的標註。','已重做一步標註。','復原 {u} 步 · 重做 {r} 步'],
  ja:['1操作戻す','1操作やり直す','すべての注釈を消去','やり直せる注釈はありません。','1操作やり直しました。','元に戻す {u} 件 · やり直す {r} 件'],
  ko:['한 단계 실행 취소','한 단계 다시 실행','모든 주석 지우기','다시 실행할 주석이 없습니다.','한 단계 다시 실행했습니다.','실행 취소 {u}단계 · 다시 실행 {r}단계'],
  en:['Undo one step','Redo one step','Clear all annotations','There is no annotation to redo.','Redid one annotation step.','Undo {u} · Redo {r}']
}))Object.assign(STRINGS[lang],{
  undo:labels[0],redo:labels[1],restore:labels[2],noRedo:labels[3],
  redoDone:labels[4],historyCounts:labels[5]
});

for(const [locale,label] of Object.entries({'zh-CN':'手动填写框首次弹出时隐藏工具条','zh-TW':'手動填寫框首次彈出時隱藏工具條',en:'Hide toolbar when the manual panel first opens',ja:'手動入力欄の初回表示時にツールバーを隠す',ko:'수동 입력창이 처음 열릴 때 도구 모음 숨기기'}))STRINGS[locale].hideToolbarOnFirstManual=label;


for(const [lang,labels] of Object.entries({
 'zh-CN':['仅点击悬浮球显示工具条','选中文字时不自动显示；开启时自动启用网页工具条和悬浮球。'],
 'zh-TW':['僅點擊浮動球顯示工具列','選取文字時不自動顯示；開啟時自動啟用網頁工具列和浮動球。'],
 en:['Show toolbar only by clicking the floating button','Text selection does not open the toolbar. Enabling this also enables the page toolbar and floating button.'],
 ja:['フローティングボタンでのみツールバーを表示','文字選択では表示しません。有効にするとページツールバーとフローティングボタンも有効になります。'],
 ko:['플로팅 버튼을 눌렀을 때만 도구 모음 표시','텍스트를 선택해도 자동으로 표시하지 않습니다. 켜면 페이지 도구 모음과 플로팅 버튼도 켜집니다.']
}))Object.assign(STRINGS[lang],{toolbarBallOnly:labels[0],toolbarBallOnlyHint:labels[1]});

function syncToolbarOptions(changed){
 if(changed===toolbarBallOnly&&toolbarBallOnly.checked){floatingBallEnabled.checked=true;mobileSelectionToolbar.checked=true;}
 if(!floatingBallEnabled.checked||!mobileSelectionToolbar.checked)toolbarBallOnly.checked=false;
 toolbarDisplay.disabled=toolbarBallOnly.checked;
}

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
  floatingBallEnabled.checked = uiSettings.floatingBallEnabled !== false;
  toolbarBallOnly.checked=uiSettings.toolbarBallOnly===true;
  stopAutoAfterPageComplete.checked=uiSettings.stopAutoAfterPageComplete ?? true;
  restoreExistingAnnotations.checked=uiSettings.restoreExistingAnnotations ?? true;
  hideToolbarOnFirstManual.checked=uiSettings.hideToolbarOnFirstManual !== false;
  clearCacheOnExit.checked=uiSettings.clearCacheOnExit ?? true;
  toolbarHangulOnly.checked=uiSettings.toolbarHangulOnly ?? true;
  toolbarDisplay.value=uiSettings.toolbarDisplay==='always'?'always':'selection';
  syncToolbarOptions();
  // Loading the popup must not inject scripts or warm up the engine.
  await refreshHistorySteps();
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

for (const input of [...copyModes, hanjaMode, loanwordMode, mobileSelectionToolbar, floatingBallEnabled, toolbarBallOnly, toolbarDisplay, stopAutoAfterPageComplete, restoreExistingAnnotations, hideToolbarOnFirstManual, clearCacheOnExit, toolbarHangulOnly]) {
  input.addEventListener('change', persistNonCopySettings);
}

async function persistNonCopySettings(event) {
  syncToolbarOptions(event?.target);
  const { uiSettings: stored = {} } = await chrome.storage.local.get('uiSettings');
  const next = {
    ...removeLegacyUiSettings(stored),
    copyMode:selectedCopyMode(),
    hanjaMode: hanjaMode.checked,
    loanwordMode: loanwordMode.checked,
    toolbarBallOnly:toolbarBallOnly.checked,floatingBallEnabled:floatingBallEnabled.checked, mobileSelectionToolbar: mobileSelectionToolbar.checked, toolbarDisplay:toolbarDisplay.value, toolbarHangulOnly:toolbarHangulOnly.checked, stopAutoAfterPageComplete:stopAutoAfterPageComplete.checked, restoreExistingAnnotations:restoreExistingAnnotations.checked,hideToolbarOnFirstManual:hideToolbarOnFirstManual.checked, clearCacheOnExit:clearCacheOnExit.checked,
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
    const frames=response.frameSummary||{};
     status.textContent=response.started===false&&!(frames.started>0)?
       '没有未标注的韩语文字。':
       t('pageStarted')+(frames.started? `（另启动 ${frames.started} 个子框架）`:'')+
       (frames.inaccessible? `；${frames.inaccessible} 个子框架不可访问`:'');
  } catch(error){showError(error);}
  finally{pageStartPending=false;runButton.disabled=false;}
});

function currentUiSettings(){
  syncToolbarOptions();
  return {hanjaMode:hanjaMode.checked,loanwordMode:loanwordMode.checked,
    copyMode:selectedCopyMode(),deepAnalysis:true,toolbarBallOnly:toolbarBallOnly.checked,floatingBallEnabled:floatingBallEnabled.checked,mobileSelectionToolbar:mobileSelectionToolbar.checked,
    toolbarDisplay:toolbarDisplay.value,toolbarHangulOnly:toolbarHangulOnly.checked,
    stopAutoAfterPageComplete:stopAutoAfterPageComplete.checked, restoreExistingAnnotations:restoreExistingAnnotations.checked,hideToolbarOnFirstManual:hideToolbarOnFirstManual.checked,clearCacheOnExit:clearCacheOnExit.checked,uiLocale:locale};
}

async function refreshHistorySteps(){
  try{
    const data=await chrome.runtime.sendMessage({type:'KRA_HISTORY_TAB'});
    if(!data?.ok)return;
    historySteps.textContent=t('historyCounts')
      .replace('{u}',data.undoDepth).replace('{r}',data.redoDepth);
    undoButton.disabled=data.undoDepth===0;
    redoButton.disabled=data.redoDepth===0;
  }catch{
    historySteps.textContent='';
  }
}

undoButton.addEventListener('click', async () => {
  try {
    const response=await chrome.runtime.sendMessage({type:'KRA_UNDO_TAB'});
    if(!response?.ok)throw new Error(response?.error||t('noUndo'));
    status.textContent=t('undoDone')+(response.undoneFrames>1?`（${response.undoneFrames} 个框架）`:'');
  } catch(error){showError(error);}
  finally{await refreshHistorySteps();}
});

redoButton.addEventListener('click',async()=>{
  try{
    const response=await chrome.runtime.sendMessage({type:'KRA_REDO_TAB'});
    if(!response?.ok)throw new Error(response?.error||t('noRedo'));
    status.textContent=t('redoDone')+(response.redoneFrames>1?`（${response.redoneFrames} 个框架）`:'');
  }catch(error){showError(error);}
  finally{await refreshHistorySteps();}
});

restoreButton.addEventListener('click', async () => {
  try {
    const response=await chrome.runtime.sendMessage({type:'KRA_RESTORE_TAB'});
    if(!response?.ok)throw new Error(response?.error||t('restored'));
    status.textContent=t('restored')+(response.restoredFrames>1?`（${response.restoredFrames} 个框架）`:'');
  } catch(error){showError(error);}
  finally{await refreshHistorySteps();}
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
  syncToolbarOptions();
  const modes = { hanja: hanjaMode.checked, loanword: loanwordMode.checked };
  if (!modes.hanja && !modes.loanword) throw new Error(t('chooseMode'));
  const settings = { modes, deepAnalysis: true, requestConcurrency: FIXED_CONCURRENCY, forceRegenerate: forceRegenerate.checked };
  const nextUiSettings = { hanjaMode: modes.hanja, loanwordMode: modes.loanword, copyMode:selectedCopyMode(), deepAnalysis: true, toolbarBallOnly:toolbarBallOnly.checked,floatingBallEnabled:floatingBallEnabled.checked, mobileSelectionToolbar: mobileSelectionToolbar.checked, toolbarDisplay:toolbarDisplay.value, toolbarHangulOnly:toolbarHangulOnly.checked, stopAutoAfterPageComplete:stopAutoAfterPageComplete.checked, restoreExistingAnnotations:restoreExistingAnnotations.checked,hideToolbarOnFirstManual:hideToolbarOnFirstManual.checked, clearCacheOnExit:clearCacheOnExit.checked, uiLocale: locale };
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
  try{
    await chrome.scripting.insertCSS({target:{tabId},files:['content.css']});
    await chrome.scripting.executeScript({target:{tabId},files:['content.js']});
  }catch(error){
    const message=String(error?.message||error||'');
    if(/Cannot access contents of (?:the page|url)|Extension manifest must request permission|Cannot access a chrome:\/\/|Cannot access a chrome-extension:\/\/|The extensions gallery cannot be scripted|Cannot script the New Tab Page/i.test(message))
      throw new Error('无法访问此页面：请允许此扩展访问当前网站后刷新。chrome://、扩展管理页、商店等受保护页面无法标注。');
    throw error;
  }
  const injected = await chrome.tabs.sendMessage(tabId,{type:'KRA_PING'});
  if (!injected?.ok || injected.version!==CONTENT_SCRIPT_VERSION) throw new Error(t('scriptFailed'));
}
function showError(error) { status.textContent = error?.message || String(error); }
