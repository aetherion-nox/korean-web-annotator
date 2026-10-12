import {menuAction} from './context-menu-state.js';
import {callBrowserEngine} from './browser-engine-host.js';
import {configureBrowserEngineHost} from './browser-engine.js';
configureBrowserEngineHost(callBrowserEngine);
import './api-profiles.js';
import {engineConfig,engineStatus} from './local-engine.js';
import {reviewTargets} from './choice-review.js';
import {runSentencePipeline,CACHE_KEY} from './annotation-pipeline.js';
import {prepareCacheSession} from './session-cache.js';
const CONTENT_SCRIPT_VERSION='1.0.3';
const UNDO_LAST_MENU_ID='kra-undo-last';
const STREAM_PORT_NAME='KRA_ANNOTATE_STREAM_V1';
const cache=new Map();
let cacheLoaded=false;
let cacheLoadPromise;
initializeStorageAccess().then(migrateLegacyApiKeyStorage).catch(console.error);
chrome.runtime.onInstalled.addListener(() => {
  initializeStorageAccess().then(migrateLegacyApiKeyStorage).catch(console.error);
  ensureContextMenu().catch(console.error);
  initializeExistingWebTabs().catch(console.error);
});
chrome.runtime.onStartup.addListener(() => {
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

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if(message?.type==='KRA_START_PAGE_FROM_POPUP'){
    startPageFromPopup(message).then(sendResponse).catch(error=>sendResponse({ok:false,error:error.message}));return true;
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
    chrome.storage.local.get('uiSettings')
      .then(({ uiSettings = {} }) => sendResponse({ ok: true, uiSettings: sanitizeUiSettings(uiSettings) }))
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

function sanitizeUiSettings(value) {
  const source = value && typeof value === 'object' ? value : {};
  return {
    hanjaMode: source.hanjaMode ?? true,
    loanwordMode: source.loanwordMode ?? true,
    mobileSelectionToolbar: source.mobileSelectionToolbar ?? true,
    selectAnnotations:source.selectAnnotations ?? false,
    copyMode:['base','annotated','hangul','annotation'].includes(source.copyMode)?source.copyMode:'hangul',
    stopAutoAfterPageComplete:source.stopAutoAfterPageComplete ?? true,
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

// This work belongs to the worker, so closing the popup cannot interrupt dispatch.
const pendingPopupPageStarts=new Map();
async function startPageFromPopup(message){
  const [tab]=await chrome.tabs.query({active:true,currentWindow:true});
  if(!tab?.id)throw new Error('没有找到当前标签页。');
  if(pendingPopupPageStarts.has(tab.id))return pendingPopupPageStarts.get(tab.id);
  const operation=(async()=>{
    const uiSettings=sanitizeUiSettings(message.uiSettings);
    const persist=chrome.storage.local.get('uiSettings').then(({uiSettings:stored={}})=>
      chrome.storage.local.set({uiSettings:{...stored,...uiSettings,clearCacheOnExit:message.uiSettings?.clearCacheOnExit??true}})
    ).catch(()=>{});
    try{
      await ensureContentScriptInFrame(tab.id,0);
      const result=await chrome.tabs.sendMessage(tab.id,{
        type:'START_ANNOTATION',modes:message.modes,forceRegenerate:Boolean(message.forceRegenerate),
        deepAnalysis:true,requestConcurrency:4,uiSettings
      },{frameId:0});
      if(!result?.ok)throw new Error(result?.error||'无法启动整页标注。');
      // Persist concurrently with dispatch rather than blocking task startup.
      await persist;
      return result;
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
  const response=await chrome.tabs.sendMessage(tab.id,{type:'START_ANNOTATION',modes:{hanja:uiSettings.hanjaMode??true,loanword:uiSettings.loanwordMode??true},forceRegenerate:false},{frameId});
  if(!response?.ok)throw Error(response?.error||'无法启动整页标注。');
 }
 await refreshPageMenu(tab.id);
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
  await chrome.scripting.insertCSS({ target, files: ['content.css'] });
  await chrome.scripting.executeScript({ target, files: ['content.js'] });
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



async function checkReady(){const config=await engineConfig();const status=await engineStatus();if(config.enableModelReview)await getApiConfig();return {mode:'local',enableModelReview:config.enableModelReview,...status};}
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
async function runModern(message,post,signal){
 await loadCache();const config=await engineConfig();
 return runSentencePipeline(message,post,{signal,enabled:config.enableModelReview,modelConfig:getApiConfig,cache,persist:async map=>chrome.storage.local.set({[CACHE_KEY]:Array.from(map)})});
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
async function runStreamingAnnotation(message,post,signal){
 if(Array.isArray(message.sentences))return runModern(message,post,signal);
 const {sentences,mapping}=legacyPlan(message);
 return runModern({...message,operationId:message.operationId||crypto.randomUUID(),sentences},event=>{
  if(event.type==='RESULTS'){
   const results=event.results.flatMap(r=>mapping.filter(m=>m.sentenceId===r.id).map(m=>({id:m.id,annotations:r.annotations.filter(a=>a.start>=m.start&&a.end<=m.end).map(a=>({...a,start:a.start-m.start,end:a.end-m.start}))})));
   post({...event,results,completedCandidates:event.completedSentences===event.totalSentences?mapping.length:0,totalCandidates:mapping.length});
  }else post({...event,completedCandidates:event.completedSentences===event.totalSentences?mapping.length:0,totalCandidates:mapping.length});
 },signal);
}
async function handleAnnotateBatch(message){
 const final=new Map();let stats;
 await runStreamingAnnotation(message,event=>{stats=event.stats;if(event.type==='RESULTS')for(const r of event.results)final.set(r.id,[...(final.get(r.id)||[]),...r.annotations]);});
 return {results:Array.from(final,([id,annotations])=>({id,annotations})),stats};
}
function handleStreamingPort(port){
 let started=false,operationId;const controller=new AbortController();
 const post=event=>{if(!controller.signal.aborted)port.postMessage(event);};
 port.onDisconnect.addListener(()=>controller.abort());
 port.onMessage.addListener(message=>{
  if(message?.type==='KEEPALIVE'){post({type:'PONG',operationId,at:Date.now()});return;}
  if(message?.type==='CANCEL'&&message.operationId===operationId){controller.abort();return;}
  if(started||message?.type!=='START')return;started=true;operationId=message.operationId||crypto.randomUUID();
  runStreamingAnnotation({...message,operationId},post,controller.signal).catch(error=>{if(!controller.signal.aborted)post({type:'ERROR',operationId,error:error.message});});
 });
}

async function migrateEngineSettings(){const state=await chrome.storage.local.get(['enableModelReview']);if(state.enableModelReview===undefined)await chrome.storage.local.set({enableModelReview:false});}
migrateEngineSettings().catch(console.error);
