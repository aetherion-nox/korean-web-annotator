import {createEnginePreloader} from './engine-preload.js';
import {menuAction} from './context-menu-state.js';
import {callBrowserEngine,copyTextToClipboard} from './browser-engine-host.js';
import {configureBrowserEngineHost} from './browser-engine.js';
configureBrowserEngineHost(callBrowserEngine);
import './api-profiles.js';
import {engineConfig,engineStatus,analyzeLocal} from './local-engine.js';
import {reviewTargets} from './choice-review.js';
import {requestLogger} from './request-log.js';
import {runSentencePipeline,CACHE_KEY} from './annotation-pipeline.js';
import {prepareCacheSession} from './session-cache.js';
import {createManualReviewSession} from './manual-review.js';
import {dispatchChildFrameBatch} from './page-frame-dispatch.js';
import {createMergedFrameReviewCoordinator} from './merged-frame-review.js';
const CONTENT_SCRIPT_VERSION='1.1.56.3-manual-lifecycle';
const UNDO_LAST_MENU_ID='kra-undo-last';
const STREAM_PORT_NAME='KRA_ANNOTATE_STREAM_V1';
const cache=new Map();
let cacheLoaded=false;
let cacheLoadPromise;
const enginePreloader=createEnginePreloader();
const preloadEngine=()=>enginePreloader.run().catch(error=>console.warn('[KRA preload]',error.message));
// Also covers extension reload/enabling and browsers that resume the worker.
preloadEngine();
initializeStorageAccess().then(migrateLegacyApiKeyStorage).catch(console.error);
chrome.runtime.onInstalled.addListener(() => {
  preloadEngine();
  initializeStorageAccess().then(migrateLegacyApiKeyStorage).catch(console.error);
  ensureContextMenu().catch(console.error);
  initializeExistingWebTabs().catch(console.error);
});
chrome.runtime.onStartup.addListener(() => {
  preloadEngine();
  loadCache().catch(console.error);
  initializeStorageAccess().then(migrateLegacyApiKeyStorage).catch(console.error);
  ensureContextMenu().catch(console.error);
  initializeExistingWebTabs().catch(console.error);
});

chrome.contextMenus.onClicked.addListener((info,tab)=>{
 if(info.menuItemId!==UNDO_LAST_MENU_ID)return;
 handlePageContextMenu(info,tab).catch(async error=>{
  console.error('[Korean annotation menu]',error);
  if(tab?.id)await setActionBadge(tab.id,'ERR','error',error.message).catch(()=>{});
 });
});
chrome.tabs.onActivated?.addListener(({tabId})=>refreshPageMenu(tabId).catch(()=>{}));
chrome.tabs.onUpdated?.addListener((tabId,change,tab)=>{
 if(tab.active && change.status)refreshPageMenu(tabId).catch(()=>{});
});

// Local storage is restricted to trusted contexts. Forward the display switch
// from the background so already-open pages receive it without reading logs/keys.
chrome.storage.onChanged.addListener((changes,area)=>{
 if(area==='local'&&changes.preloadEngineOnStartup&&changes.preloadEngineOnStartup.newValue!==false)preloadEngine();
 if(area==='local'&&changes.floatingBallPosition){
  const position=sanitizeFloatingBallPosition(changes.floatingBallPosition.newValue);
  if(position)chrome.tabs.query({}).then(tabs=>Promise.allSettled(tabs.filter(tab=>Number.isInteger(tab.id)).map(tab=>chrome.tabs.sendMessage(tab.id,{type:'APPLY_FLOATING_BALL_POSITION',position})))).catch(()=>{});
 }
 if(area!=='local'||(!changes.progressiveAnnotation&&!changes.uiSettings))return;
 const uiSettings={...(changes.uiSettings?sanitizeUiSettings(changes.uiSettings.newValue):{}),...(changes.progressiveAnnotation?{progressiveAnnotation:changes.progressiveAnnotation.newValue===true}:{})};
 chrome.tabs.query({}).then(tabs=>Promise.allSettled(tabs.filter(tab=>Number.isInteger(tab.id)).map(tab=>chrome.tabs.sendMessage(tab.id,{type:'APPLY_UI_SETTINGS',uiSettings})))).catch(()=>{});
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if(message?.type==='KRA_PRELOAD_ENGINE'){
    if(sender.id!==chrome.runtime.id){sendResponse({ok:false,error:'Invalid extension sender'});return;}
    preloadEngine().then(()=>sendResponse({ok:true}));return true;
  }
  if(message?.type==='SET_FLOATING_BALL_POSITION'){
    const position=sanitizeFloatingBallPosition(message.position);
    if(sender.id!==chrome.runtime.id||!position){sendResponse({ok:false,error:'Invalid floating ball position'});return;}
    chrome.storage.local.set({floatingBallPosition:position}).then(()=>sendResponse({ok:true})).catch(error=>sendResponse({ok:false,error:error.message}));return true;
  }
  if(message?.type==='KRA_COPY_TEXT'){
    if(sender.id!==chrome.runtime.id){sendResponse({ok:false,error:'Invalid extension sender'});return;}
    copyTextToClipboard(message.text).then(sendResponse).catch(error=>sendResponse({ok:false,error:error.message}));return true;
  }
  if(message?.type==='KRA_START_PAGE_FROM_POPUP'){
    startPageFromPopup(message).then(sendResponse).catch(error=>sendResponse({ok:false,error:error.message}));return true;
  }
  if(message?.type==='KRA_START_PAGE_FROM_TOOLBAR'){
    // A child frame must never initiate its own duplicate whole-page batch.
    // Select the exact tab of the trusted content-script sender.
    if(sender.id!==chrome.runtime.id||sender.frameId!==0||!Number.isInteger(sender.tab?.id)){
      sendResponse({ok:false,error:'整页工具条仅允许从主框架启动。'});return;
    }
    startWholePageForTab(sender.tab.id,{
      modes:{hanja:message.modes?.hanja!==false,loanword:message.modes?.loanword!==false},
      forceRegenerate:message.forceRegenerate===true,
      uiSettings:message.uiSettings||{},trigger:'toolbar'
    }).then(sendResponse).catch(error=>sendResponse({ok:false,error:error.message}));
    return true;
  }
  if(message?.type==='KRA_CONTEXT_UPDATE'){
    chrome.tabs.query({active:true,currentWindow:true}).then(([tab])=>{if(tab?.id===sender.tab?.id)return updatePageMenu(message.state);}).then(()=>sendResponse({ok:true})).catch(()=>sendResponse({ok:false}));return true;
  }
  if (message?.type === 'ANNOTATE_BATCH') {
    handleAnnotateBatch(message)
      .then(({ results, stats }) => sendResponse({ ok: true, results, stats }))
      .catch(error => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === 'GET_UI_SETTINGS') {
    chrome.storage.local.get(['uiSettings','progressiveAnnotation','floatingBallPosition'])
      .then(({ uiSettings = {}, progressiveAnnotation = false, floatingBallPosition }) => sendResponse({ ok: true, uiSettings: {...sanitizeUiSettings(uiSettings),progressiveAnnotation:progressiveAnnotation===true,floatingBallPosition:sanitizeFloatingBallPosition(floatingBallPosition)} }))
      .catch(error => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === 'REFRESH_CONTEXT_MENU') {
    ensureContextMenu()
      .then(() => sendResponse({ ok: true }))
      .catch(error => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === 'CHECK_ENGINE_READY') {
    engineStatus().then(status => sendResponse({ok:true,...status})).catch(error => sendResponse({ok:false,error:error.message}));
    return true;
  }

  if (message?.type === 'CHECK_API_READY') {
    checkReady()
      .then(config => sendResponse({ ok: true, ...config }))
      .catch(error => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === 'TEST_API') {
    testApi()
      .then(text => sendResponse({ ok: true, message: text }))
      .catch(error => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === 'CLEAR_MODEL_REQUEST_LOGS') {
    requestLogger.clear().then(()=>sendResponse({ok:true})).catch(error=>sendResponse({ok:false,error:error.message}));
    return true;
  }

  if (message?.type === 'CLEAR_ANNOTATION_CACHE') {
    clearAnnotationCache()
      .then(() => sendResponse({ ok: true }))
      .catch(error => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === 'MARK_STREAM_UNSTABLE') {
    markCurrentProviderStreamUnstable()
      .then(() => sendResponse({ ok: true }))
      .catch(error => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === 'SET_BADGE') {
    const tabId = sender.tab?.id;
    if (tabId) {
      setActionBadge(
        tabId,
        String(message.text || '').slice(0, 4),
        message.kind === 'error' ? 'error' : 'normal',
        String(message.title || 'Korean Ruby Annotator')
      ).catch(() => {});
    }
    sendResponse({ ok: true });
  }
});

chrome.runtime.onConnect.addListener(port => {
  if (![STREAM_PORT_NAME, 'KRA_SENTENCE_STREAM_V1'].includes(port.name)) return;
  handleStreamingPort(port);
});


async function setActionBadge(tabId, text, kind = 'normal', title = 'Korean Ruby Annotator') {
  await Promise.all([
    chrome.action.setBadgeText({ tabId, text }),
    chrome.action.setBadgeBackgroundColor({
      tabId,
      color: kind === 'error' ? '#B3261E' : '#356AA0'
    }),
    chrome.action.setTitle({ tabId, title })
  ]);
}

function sanitizeFloatingBallPosition(position){
  return position&&Number.isFinite(position.x)&&Number.isFinite(position.y)&&position.x>=0&&position.x<=1&&position.y>=0&&position.y<=1?{x:position.x,y:position.y}:undefined;
}

function sanitizeUiSettings(value) {
  const source = value && typeof value === 'object' ? value : {};
  return {
    hanjaMode: source.hanjaMode ?? true,
    loanwordMode: source.loanwordMode ?? true,
    mobileSelectionToolbar: source.mobileSelectionToolbar ?? true,
    floatingBallEnabled: source.floatingBallEnabled !== false,
    toolbarBallOnly:source.toolbarBallOnly===true&&source.floatingBallEnabled!==false&&source.mobileSelectionToolbar!==false,
    selectAnnotations:source.selectAnnotations ?? false,
    copyMode:['base','annotated','hangul','annotation'].includes(source.copyMode)?source.copyMode:'hangul',
    stopAutoAfterPageComplete:source.stopAutoAfterPageComplete ?? true,
    restoreExistingAnnotations:source.restoreExistingAnnotations ?? true,
    hideToolbarOnFirstManual:source.hideToolbarOnFirstManual !== false,
    toolbarHangulOnly:source.toolbarHangulOnly ?? true,
    toolbarDisplay:source.toolbarDisplay==='always'?'always':'selection',
    uiLocale: normalizeUiLocale(source.uiLocale)
  };
}

function normalizeUiLocale(value) {
  return ['zh-CN', 'zh-TW', 'ja', 'ko', 'en'].includes(value) ? value : 'zh-CN';
}

const MENU_I18N = {
  'zh-CN': { selection:'标注所选韩语', page:'生成整页韩语标注', undo: '撤销上次韩语标注' },
  'zh-TW': { selection:'標註所選韓語', page:'產生整頁韓語標註', undo: '撤銷上次韓語標註' },
  ja: { selection:'選択範囲の韓国語注釈', page:'ページ全体を韓国語注釈', undo: '直前の韓国語注釈を元に戻す' },
  ko: { selection:'선택한 한국어 주석', page:'페이지 전체 한국어 주석', undo: '마지막 한국어 주석 실행 취소' },
  en: { selection:'Annotate selected Korean', page:'Annotate entire page', undo: 'Undo last Korean annotation' }
};

async function initializeStorageAccess() {
  if (typeof chrome.storage?.local?.setAccessLevel === 'function') {
    await chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
  }
  if (typeof chrome.storage?.session?.setAccessLevel === 'function') {
    await chrome.storage.session.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
  }
}

async function migrateLegacyApiKeyStorage() {
  const {
    PROFILE_STORAGE_KEY,
    ACTIVE_PROFILE_KEY,
    SESSION_KEYS_KEY,
    migrateApiProfileState
  } = globalThis.KRA_API_PROFILES;
  const [localState, sessionState] = await Promise.all([
    chrome.storage.local.get([PROFILE_STORAGE_KEY, ACTIVE_PROFILE_KEY, 'apiConfig', 'persistentApiKey', 'localApiKey', 'encryptedApiKey']),
    chrome.storage.session.get([SESSION_KEYS_KEY, 'apiKey'])
  ]);
  const migrated = migrateApiProfileState(localState, sessionState);
  await Promise.all([
    chrome.storage.local.set({
      [PROFILE_STORAGE_KEY]: migrated.profiles,
      [ACTIVE_PROFILE_KEY]: migrated.activeId
    }),
    chrome.storage.session.set({ [SESSION_KEYS_KEY]: migrated.sessionKeys })
  ]);
  await Promise.all([
    chrome.storage.local.remove(['apiConfig', 'persistentApiKey', 'localApiKey', 'encryptedApiKey']),
    chrome.storage.session.remove('apiKey')
  ]);
}



async function initializeExistingWebTabs() {
  // Static content_scripts handle every new navigation. This pass covers tabs
  // that were already open when the extension was installed, updated, enabled,
  // or the browser restored a previous mobile session.
  const tabs = await chrome.tabs.query({});
  const tasks = [];
  for (const tab of tabs) {
    if (!Number.isInteger(tab?.id) || tab.discarded) continue;
    tasks.push(ensureContentScriptInFrame(tab.id, 0));
  }
  await Promise.allSettled(tasks);
}

// User-initiated multi-frame dispatch. A short grace window discovers late
// iframe navigations but cannot cause indefinite background model requests.
const pendingPopupPageStarts=new Map();
const activeFrameScans=new Map();
const FRAME_DISCOVERY_GRACE_MS=15000;
const MERGE_COLLECTION_MS=4800;
const mergedFrameReviews=createMergedFrameReviewCoordinator({
 run:(message,post,signal,session)=>runStreamingAnnotation(message,post,signal,session),
 createSession:config=>createManualReviewSession(config)
});

async function inspectChildFrames(tabId,run){
 if(activeFrameScans.get(tabId)!==run||run.finalizing||Date.now()>run.until)return null;
 const list=await chrome.webNavigation.getAllFrames({tabId});
 if(!Array.isArray(list))return {discovered:0,started:0,unavailable:true};
 const report=await dispatchChildFrameBatch(list,{
  started:run.started,concurrency:3,
  ensure:async frame=>ensureContentScriptInFrame(tabId,frame.frameId),
  probe:async frame=>chrome.tabs.sendMessage(tabId,{type:'KRA_FRAME_PROBE'},{frameId:frame.frameId}),
  start:async frame=>chrome.tabs.sendMessage(tabId,{
   type:'START_ANNOTATION',modes:run.modes,deepAnalysis:true,
   forceRegenerate:run.forceRegenerate,requestConcurrency:4,uiSettings:run.uiSettings,
   mergeGroupId:run.groupId,mergeHost:false
  },{frameId:frame.frameId})
 });
 if(report.started||report.failed||report.inaccessible){
  chrome.tabs.sendMessage(tabId,{type:'KRA_FRAME_DISPATCH_DIAGNOSTIC',
   summary:`子框架扫描：发现 ${report.discovered}，新启动 ${report.started}，无可见韩文 ${report.empty}，无法访问 ${report.inaccessible}，失败 ${report.failed}。`,
   detail:{...report,trigger:run.trigger}},{frameId:0}).catch(()=>{});
 }
 return report;
}
function queueChildFrameScan(tabId,run,delay=650){
 if(activeFrameScans.get(tabId)!==run||run.finalizing||Date.now()>run.until)return;
 clearTimeout(run.timer);
 run.timer=setTimeout(()=>{
  if(activeFrameScans.get(tabId)!==run||run.finalizing||Date.now()>run.until)return;
  run.serial=run.serial.then(()=>inspectChildFrames(tabId,run)).catch(error=>
   console.warn('[KRA frame discovery]',error.message));
 },delay);
}
chrome.webNavigation?.onDOMContentLoaded?.addListener(details=>{
 if(!details||details.frameId===0)return;
 const run=activeFrameScans.get(details.tabId);
 if(run)queueChildFrameScan(details.tabId,run,500);
});
chrome.webNavigation?.onCommitted?.addListener(details=>{
 if(details?.frameId!==0)return;
 const run=activeFrameScans.get(details.tabId);
 if(run){
  clearTimeout(run.timer);clearTimeout(run.finalizer);
  mergedFrameReviews.abort(run.groupId,'网页已导航，取消已过时的跨框架审核。');
  activeFrameScans.delete(details.tabId);
 }
});

async function startWholePageForTab(tabId,settings){
 const uiSettings=sanitizeUiSettings(settings.uiSettings);
 const groupId='frame-group-'+tabId+'-'+crypto.randomUUID();
 const run={groupId,until:Date.now()+FRAME_DISCOVERY_GRACE_MS,started:new Set(),
  serial:Promise.resolve(),timer:null,finalizer:null,finalizing:false,modes:settings.modes,
  forceRegenerate:Boolean(settings.forceRegenerate),uiSettings,
  trigger:settings.trigger||'popup'};
 const previous=activeFrameScans.get(tabId);
 if(previous){
  clearTimeout(previous.timer);clearTimeout(previous.finalizer);
  mergedFrameReviews.abort(previous.groupId,'新一轮整页标注开始，已取消上一轮合并审核。');
 }
 mergedFrameReviews.open(groupId,tabId);
 try{await ensureContentScriptInFrame(tabId,0);}
 catch(error){mergedFrameReviews.abort(groupId,error.message);throw error;}
 const main=await chrome.tabs.sendMessage(tabId,{
  type:'START_ANNOTATION',modes:run.modes,forceRegenerate:run.forceRegenerate,
  deepAnalysis:true,requestConcurrency:4,uiSettings,
  mergeGroupId:groupId,mergeHost:true
 },{frameId:0});
 if(!main?.ok){
  mergedFrameReviews.abort(groupId,main?.error||'无法启动整页标注。');
  throw new Error(main?.error||'无法启动整页标注。');
 }
 activeFrameScans.set(tabId,run);
 run.serial=run.serial.then(()=>inspectChildFrames(tabId,run));
 const children=await run.serial.catch(error=>{
  console.warn('[KRA frame discovery]',error.message);
  return {discovered:0,started:0,failed:1,error:error.message};
 });
 // Collect all frame START messages into one source-shared analysis.
 // Hydration gets one bounded collection window, rather than independent
 // manual prompts or repeated API context for every iframe.
 queueChildFrameScan(tabId,run,950);
 run.finalizer=setTimeout(()=>{
  if(activeFrameScans.get(tabId)!==run)return;
  run.finalizing=true;clearTimeout(run.timer);
  run.serial=run.serial.then(async()=>{
   // Final pass after the DOM hydration grace; no new frames after closure.
   run.finalizing=false;
   await inspectChildFrames(tabId,run);
   run.finalizing=true;
   mergedFrameReviews.finalize(groupId).catch(error=>
    console.warn('[KRA merged frame review]',error.message));
  }).catch(error=>{
   mergedFrameReviews.abort(groupId,error.message);
  }).finally(()=>{
   if(activeFrameScans.get(tabId)===run)activeFrameScans.delete(tabId);
  });
 },MERGE_COLLECTION_MS);
 return {...main,frameSummary:children};
}

async function startPageFromPopup(message){
 const [tab]=await chrome.tabs.query({active:true,currentWindow:true});
 if(!tab?.id)throw new Error('没有找到当前标签页。');
 if(pendingPopupPageStarts.has(tab.id))return pendingPopupPageStarts.get(tab.id);
 const operation=(async()=>{
  const uiSettings=sanitizeUiSettings(message.uiSettings);
  const persist=chrome.storage.local.get('uiSettings').then(({uiSettings:stored={}})=>
   chrome.storage.local.set({uiSettings:{...stored,...uiSettings,
    clearCacheOnExit:message.uiSettings?.clearCacheOnExit??true}})
  ).catch(()=>{});
  try{
   const response=await startWholePageForTab(tab.id,{...message,uiSettings,trigger:'popup'});
   await persist;return response;
  }finally{pendingPopupPageStarts.delete(tab.id);}
 })();
 pendingPopupPageStarts.set(tab.id,operation);return operation;
}

async function ensureContextMenu() {
  const { uiSettings = {} } = await chrome.storage.local.get('uiSettings');
  const locale = normalizeUiLocale(uiSettings.uiLocale);
  const labels = MENU_I18N[locale] || MENU_I18N.en;
  await chrome.contextMenus.removeAll();
  chrome.contextMenus.create({ id: UNDO_LAST_MENU_ID, title: labels.page, contexts: ['page','selection'] });
  const [tab]=await chrome.tabs.query({active:true,currentWindow:true});
  if(tab?.id)await refreshPageMenu(tab.id);
}

async function readPageMenuState(tabId,frameId=0){
 try{return await chrome.tabs.sendMessage(tabId,{type:'KRA_CONTEXT_STATE'},{frameId});}catch{return {};}
}
async function updatePageMenu(state){
 const {uiSettings={}}=await chrome.storage.local.get('uiSettings');
 const labels=MENU_I18N[normalizeUiLocale(uiSettings.uiLocale)]||MENU_I18N.en;
 const action=menuAction(state);
 const title=action==='undo'?labels.undo:action==='selection'?labels.selection:labels.page;
 await chrome.contextMenus.update(UNDO_LAST_MENU_ID,{title});
}
async function refreshPageMenu(tabId){
 const state=await readPageMenuState(tabId);
 const [active]=await chrome.tabs.query({active:true,currentWindow:true});
 if(active?.id===tabId)await updatePageMenu(state);
}
async function handlePageContextMenu(info,tab){
 if(!tab?.id)throw Error('没有找到当前标签页。');
 const frameId=Number.isInteger(info.frameId)?info.frameId:0;
 await ensureContentScriptInFrame(tab.id,frameId);
 const state=await readPageMenuState(tab.id,frameId);
 if(!state.ok)state.hasSelection=Boolean(info.selectionText);
 const action=menuAction(state);
 if(action==='undo')await handleUndoContextMenu(info,tab);
 else if(action==='selection')await handleSelectionContextMenu(info,tab);
 else{
  const {uiSettings={}}=await chrome.storage.local.get('uiSettings');
  const modes={hanja:uiSettings.hanjaMode??true,loanword:uiSettings.loanwordMode??true};
  const response=frameId===0?
   await startWholePageForTab(tab.id,{modes,forceRegenerate:false,uiSettings,trigger:'context-menu'}):
   await chrome.tabs.sendMessage(tab.id,{type:'START_ANNOTATION',modes,forceRegenerate:false},{frameId});
  if(!response?.ok)throw Error(response?.error||'无法启动整页标注。');
 }
 await refreshPageMenu(tab.id);
}

function actionablePageAccessError(error){
 const message=String(error?.message||error||'');
 if(/Cannot access contents of (?:the page|url)|Extension manifest must request permission|Cannot access a chrome:\/\/|Cannot access a chrome-extension:\/\/|The extensions gallery cannot be scripted|Cannot script the New Tab Page|The pages of a browser extension cannot be scripted/i.test(message))
  return new Error('无法访问此页面：普通网站请在扩展详情的「网站访问权限」中允许访问该站点（或所有网站），然后刷新网页；chrome://、浏览器扩展页、商店等受保护页面不支持注入。');
 return error;
}
async function ensureContentScriptInFrame(tabId, frameId = 0) {
  const messageOptions = { frameId };
  try {
    const existing = await chrome.tabs.sendMessage(tabId, { type: 'KRA_PING' }, messageOptions);
    if (existing?.ok && existing.version === CONTENT_SCRIPT_VERSION) return;
  } catch {
    // Missing or invalidated content script: inject the current version below.
  }

  const target = { tabId, frameIds: [frameId] };
  try{
   await chrome.scripting.insertCSS({ target, files: ['content.css'] });
   await chrome.scripting.executeScript({ target, files: ['content.js'] });
  }catch(error){throw actionablePageAccessError(error);}
  const injected = await chrome.tabs.sendMessage(tabId, { type: 'KRA_PING' }, messageOptions);
  if (!injected?.ok || injected.version !== CONTENT_SCRIPT_VERSION) {
    throw new Error('内容脚本没有正确启动，请刷新当前网页后重试。');
  }
}

async function handleSelectionContextMenu(info, tab) {
  if (!tab?.id) throw new Error('没有找到当前标签页。');
  if (!/[가-힣]/.test(String(info.selectionText || ''))) {
    await setActionBadge(tab.id, 'ERR', 'error', '所选文字中没有韩文，未执行标注。');
    return;
  }

  const { uiSettings = {} } = await chrome.storage.local.get('uiSettings');
  const modes = {
    hanja: uiSettings.hanjaMode ?? true,
    loanword: uiSettings.loanwordMode ?? true
  };
  if (!modes.hanja && !modes.loanword) {
    throw new Error('请先在插件弹窗中启用至少一种标注模式。');
  }

  const frameId = Number.isInteger(info.frameId) ? info.frameId : 0;
  await ensureContentScriptInFrame(tab.id, frameId);

  const response = await chrome.tabs.sendMessage(tab.id, {
    type: 'START_SELECTION_ANNOTATION',
    modes,
    deepAnalysis: true,
    requestConcurrency: 4,
    forceRegenerate: false
  }, { frameId });

  if (!response?.ok) throw new Error(response?.error || '无法读取当前选区。');
}


async function handleUndoContextMenu(info, tab) {
  if (!tab?.id) throw new Error('没有找到当前标签页。');
  const frameId = Number.isInteger(info?.frameId) ? info.frameId : 0;
  await ensureContentScriptInFrame(tab.id, frameId);
  const response = await chrome.tabs.sendMessage(tab.id, { type: 'UNDO_LAST_ANNOTATION' }, { frameId });
  if (!response?.ok) throw new Error(response?.error || '没有可以撤销的标注。');
}



async function getApiConfig() {
  await migrateLegacyApiKeyStorage();
  const { PROFILE_STORAGE_KEY, ACTIVE_PROFILE_KEY, SESSION_KEYS_KEY, normalizeProfiles } = globalThis.KRA_API_PROFILES;
  const [localState, sessionState] = await Promise.all([
    chrome.storage.local.get([PROFILE_STORAGE_KEY, ACTIVE_PROFILE_KEY]),
    chrome.storage.session.get(SESSION_KEYS_KEY)
  ]);
  const profiles = normalizeProfiles(localState[PROFILE_STORAGE_KEY]);
  const activeId = String(localState[ACTIVE_PROFILE_KEY] || '');
  const profile = profiles[activeId] || profiles[Object.keys(profiles)[0]];
  if (!profile) throw new Error('请先在 API 设置中建立一个模型配置。');

  const sessionKeys = sessionState[SESSION_KEYS_KEY] && typeof sessionState[SESSION_KEYS_KEY] === 'object'
    ? sessionState[SESSION_KEYS_KEY]
    : {};
  const endpoint = String(profile.endpoint || '');
  const model = String(profile.model || '');
  const apiKey = String(sessionKeys[profile.id] || (profile.keyStorageMode === 'local' ? profile.localApiKey : '') || '');
  const minConfidence = Number(profile.minConfidence ?? 0.88);
  const disableThinking = profile.disableThinking ?? true;
  const paragraphFastPath = profile.paragraphFastPath ?? true;

  if (!endpoint || !model) throw new Error('请先在 API 设置中填写接口地址和模型名。');
  const url = new URL(endpoint);
  const localHttp = url.protocol === 'http:' && (url.hostname === 'localhost' || url.hostname === '127.0.0.1');
  if (url.protocol !== 'https:' && !localHttp) throw new Error('不允许访问非 HTTPS 的远程 API。');
  if (!apiKey && !localHttp) {
    if (profile.keyStorageMode === 'encrypted' && profile.encryptedApiKey) {
      throw new Error('当前配置的 API Key 已加密保存但尚未解锁，请在 API 设置中解锁。');
    }
    throw new Error('没有找到 API Key。');
  }

  if(chrome.permissions?.contains && !await chrome.permissions.contains({origins:[`${url.origin}/*`]})) {
    throw new Error('尚未授权访问此 API 域名。请在 API 设置页重新保存配置并允许域名访问。');
  }

  return {
    endpoint: url.href,
    model,
    apiKey,
    minConfidence,
    disableThinking,
    provider: profile.provider,
    reasoningEffort: profile.reasoningEffort,
    paragraphFastPath,
    keyStorageMode: profile.keyStorageMode || 'session',
    profileId: profile.id,
    profileName: profile.name
  };
}



async function checkReady(){const config=await engineConfig();
 const allowNoDictionary=config.enableModelReview&&(config.experimentalHanja||config.experimentalLoanword);
 const status=await engineStatus(undefined,undefined,{allowNoDictionary});
 if(config.enableModelReview&&!config.manualModelReview)await getApiConfig();
 return {mode:'local',enableModelReview:config.enableModelReview,manualModelReview:config.manualModelReview,...status};
}
async function clearAnnotationCache(){await loadCache();cache.clear();cacheLoaded=true;await chrome.storage.local.remove(CACHE_KEY);}
async function markCurrentProviderStreamUnstable(){return;}
async function testApi(){
 const config=await getApiConfig();
 const target={target_id:'test-id',start:0,end:2,surface:'경제',context:'경제',options:[{choice_id:'KEEP',type:'keep',replacement:'경제',entry_id:null,definitions:[]}]};
 const result=await reviewTargets({...config,enableModelReview:true},[target]);
 if(result.accepted.length!==1)throw Error(result.errors?.length ? result.errors.map(e=>`${e.message}: ${e.detail||''}`).join('\n') : 'API did not return a valid dictionary choice ID');
 return 'API ID protocol test succeeded.';
}
async function loadCache(){
 if(cacheLoaded)return;
 if(!cacheLoadPromise)cacheLoadPromise=(async()=>{await prepareCacheSession(chrome.storage,CACHE_KEY);const saved=(await chrome.storage.local.get(CACHE_KEY))[CACHE_KEY];if(Array.isArray(saved))for(const [key,value] of saved)cache.set(key,value);cacheLoaded=true;})().finally(()=>{cacheLoadPromise=null;});
 await cacheLoadPromise;
}
async function runModern(message,post,signal,manualSession){
 await loadCache();const config=await engineConfig();
 if(config.manualModelReview&&!manualSession)throw Error('手动聊天审核需要网页输入框，请从网页标注入口启动。');
 const modelConfig=async()=>({...(config.manualModelReview?{provider:'manual',model:'manual-chat',endpoint:'manual://chat',manualReview:true,request:manualSession.request}:await getApiConfig()),batchContextTier:config.batchContextTier,manualOutputTokenLimit:config.manualOutputTokenLimit,apiOutputTokenLimit:config.apiOutputTokenLimit,reviewPosFilter:config.reviewPosFilter,experimentalHanja:config.experimentalHanja,experimentalLoanword:config.experimentalLoanword,hanjaReadingCheck:config.hanjaReadingCheck,smartSegmentation:config.smartSegmentation});
  const allowNoDictionary=config.enableModelReview&&(
   config.experimentalHanja===true&&message.modes?.hanja===true||
   config.experimentalLoanword===true&&message.modes?.loanword===true);
  const status=(signal,progress)=>engineStatus(signal,progress,{allowNoDictionary});
  const analyze=(text,modes,signal,progress)=>analyzeLocal(text,{...modes,allowNoDictionary},signal,progress);
  return runSentencePipeline({...message,nameProtection:config.nameProtection,filterDictionaryPeople:config.filterDictionaryPeople,smartSegmentation:config.smartSegmentation,reviewAllCandidates:config.reviewAllCandidates,reviewLocalConversions:config.enableModelReview&&config.reviewLocalConversions},post,{signal,enabled:config.enableModelReview,modelConfig,status,analyze,cache,persist:async map=>chrome.storage.local.set({[CACHE_KEY]:Array.from(map)})});
}
function legacyPlan(message){
 const candidates=Array.isArray(message.candidates)?message.candidates:(message.batches||[]).flat();
 const sentences=[],mapping=[];const byText=new Map();
 for(const c of candidates){
  if(typeof c.id!=='string'||typeof c.token!=='string')continue;
  const context=typeof c.paragraphText==='string'?c.paragraphText:c.token;
  const start=context===c.token?0:c.paragraphStart,end=context===c.token?c.token.length:c.paragraphEnd;
  if(!Number.isInteger(start)||!Number.isInteger(end)||context.slice(start,end)!==c.token)continue;
  if(!byText.has(context)){const id=`s${sentences.length}`;byText.set(context,id);sentences.push({id,text:context});}
  mapping.push({id:c.id,sentenceId:byText.get(context),start,end});
 }
 return {sentences,mapping};
}
async function runStreamingAnnotation(message,post,signal,manualSession){
 if(Array.isArray(message.sentences))return runModern(message,post,signal,manualSession);
 const {sentences,mapping}=legacyPlan(message);
 return runModern({...message,operationId:message.operationId||crypto.randomUUID(),sentences},event=>{
  if(event.type==='RESULTS'){
   const results=event.results.flatMap(r=>mapping.filter(m=>m.sentenceId===r.id).map(m=>({id:m.id,annotations:r.annotations.filter(a=>a.start>=m.start&&a.end<=m.end).map(a=>({...a,start:a.start-m.start,end:a.end-m.start}))})));
   post({...event,results,completedCandidates:event.completedSentences===event.totalSentences?mapping.length:0,totalCandidates:mapping.length});
  }else post({...event,completedCandidates:event.completedSentences===event.totalSentences?mapping.length:0,totalCandidates:mapping.length});
 },signal,manualSession);
}
async function handleAnnotateBatch(message){
 const final=new Map();let stats;
 await runStreamingAnnotation(message,event=>{stats=event.stats;if(event.type==='RESULTS')for(const r of event.results)final.set(r.id,[...(final.get(r.id)||[]),...r.annotations]);});
 return {results:Array.from(final,([id,annotations])=>({id,annotations})),stats};
}
function handleStreamingPort(port){
 let started=false,operationId,manualSession,groupId=null;const controller=new AbortController();
 const post=event=>{if(!controller.signal.aborted)port.postMessage(event);};
 const participant=()=>({port,tabId:port.sender?.tab?.id,frameId:port.sender?.frameId,
  operationId});
 port.onDisconnect.addListener(()=>{
  controller.abort();
  if(groupId)mergedFrameReviews.detach(groupId,participant());
 });
 port.onMessage.addListener(message=>{
  if(message?.type==='KEEPALIVE'){post({type:'PONG',operationId,at:Date.now()});return;}
  if(message?.type==='CANCEL'&&message.operationId===operationId){
   controller.abort();
   if(groupId)mergedFrameReviews.abort(groupId,'合并审核已取消。');
   return;
  }
  if(message?.type==='MANUAL_REVIEW_RESPONSE'){
   if(groupId)mergedFrameReviews.respond(groupId,participant(),message);
   else manualSession?.submit(message);
   return;
  }
  if(started||message?.type!=='START')return;
  started=true;operationId=message.operationId||crypto.randomUUID();
  if(typeof message.mergeGroupId==='string'&&message.mergeGroupId){
   groupId=message.mergeGroupId;
   try{
    const item=participant();
    if(!Number.isInteger(item.tabId)||!Number.isInteger(item.frameId))
     throw Error('Missing trusted sender frame identity');
    mergedFrameReviews.join(groupId,{...item,message});
   }catch(error){
    post({type:'ERROR',operationId,error:error.message});
   }
   return;
  }
  manualSession=createManualReviewSession({operationId,post,signal:controller.signal});
  runStreamingAnnotation({...message,operationId},post,controller.signal,manualSession)
   .catch(error=>{if(!controller.signal.aborted)post({type:'ERROR',operationId,error:error.message});});
 });
}


async function migrateEngineSettings(){const state=await chrome.storage.local.get(['enableModelReview']);if(state.enableModelReview===undefined)await chrome.storage.local.set({enableModelReview:false});}
migrateEngineSettings().catch(console.error);
