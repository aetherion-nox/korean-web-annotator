const profileSelect = document.querySelector('#profileSelect');
const profileNameInput = document.querySelector('#profileName');
const newProfileButton = document.querySelector('#newProfileButton');
const deleteProfileButton = document.querySelector('#deleteProfileButton');
const endpointInput = document.querySelector('#endpoint');
const modelInput = document.querySelector('#model');
const providerInput = document.querySelector('#provider');
const modelSelect = document.querySelector('#modelSelect');
const effortInput = document.querySelector('#reasoningEffort');
const legacyCatalog = globalThis.KRA_MODEL_CATALOG;
const registry = globalThis.KRA_PROVIDER_REGISTRY;
const directory = globalThis.KRA_PROVIDER_DIRECTORY;
const catalog = {...legacyCatalog,providers:registry?.providers || legacyCatalog.providers};
const element = id => document.getElementById(id);
let directoryEntry = null;
let routerDeveloperFilter = null;
let ollamaDetail = null;
let providerReference = null;
let publicModelMetadata = [];
let directoryRevision = 0;
let routerRevision = 0;
let routerOptions = [];
let routerModel = '';
let routerSelection = '';
let verifiedRouterProviders = false;
let routerProviderParameters = null;
const refreshStatuses = new Map();
const apiKeyInput = document.querySelector('#apiKey');
const disableThinkingInput = document.querySelector('#disableThinking');
const storageModeInputs = [...document.querySelectorAll('input[name="keyStorageMode"]')];
const encryptedControls = document.querySelector('#encryptedControls');
const passphraseInput = document.querySelector('#passphrase');
const confirmPassphraseInput = document.querySelector('#confirmPassphrase');
const unlockButton = document.querySelector('#unlockButton');
const lockButton = document.querySelector('#lockButton');
const saveButton = document.querySelector('#saveButton');
const testButton = document.querySelector('#testButton');
const uiLocale = document.querySelector('#uiLocale');
const status = document.querySelector('#status');
const encoder = new TextEncoder();
const decoder = new TextDecoder();

const STRINGS = {
  'zh-CN': {
    title:'API 设置', intro:'支持 OpenAI、Claude 原生 API，以及 Chat Completions 兼容接口和本地服务。', profiles:'API / 模型配置档案', profile:'当前配置', profileName:'配置名称', newProfile:'新建配置', deleteProfile:'删除当前配置', profileHint:'每个配置分别保存接口、模型和 API Key 保存方式；切换后立即作为当前模型使用。', cannotDeleteLast:'至少保留一个配置。', endpoint:'接口完整地址', model:'模型名', apiKey:'API Key', keyStorage:'API Key 保存方式',
    sessionOnly:'仅保存在当前浏览器会话中（推荐）', localPlain:'保存在本机，浏览器重启后自动可用', encryptedLocal:'使用口令加密后保存到本地',
    passphrase:'加密口令', confirmPassphrase:'确认加密口令', unlock:'解锁已保存的 Key', lock:'立即锁定',
    securityWarning:'推荐“仅本次会话”。选择“保存在本机”会把 API Key 持久保存在扩展的本地存储中，使用方便，但它不是安全保险箱。口令加密可避免 Key 以明文持久保存，但浏览器重启后需要重新解锁。任何方式都无法抵御已经控制浏览器、系统或扩展运行环境的恶意程序；请勿在公用设备上保存 Key。',
    reduceReasoning:'关闭思考（不支持关闭的模型使用最低强度）', save:'保存设置', test:'测试 API', saved:'设置已保存。', localSaved:'API Key 已保存在本机。', encryptedSaved:'API Key 已加密保存到本地；口令没有保存。', testing:'正在测试…', testFailed:'API 测试失败。', testSuccess:'测试成功', remoteHttps:'远程接口必须使用 HTTPS；HTTP 只允许 localhost/127.0.0.1。', needModel:'请填写模型名。', needKey:'请填写 API Key，或使用当前已保存/已解锁的 Key。', badConfidence:'置信度必须在 0 到 1 之间。', permissionDenied:'未获得访问该 API 域名的权限。', passMismatch:'两次输入的加密口令不一致。', passRequired:'请输入加密口令。', unlocked:'已解锁，本次浏览器会话可以使用该 API Key。', locked:'已锁定，本次会话中的明文 API Key 已清除。', noEncrypted:'没有找到已加密保存的 API Key。', unlockFailed:'解锁失败，请检查口令。', encryptedPlaceholder:'已加密保存；输入口令后可解锁', sessionPlaceholder:'输入 API Key', savedPlaceholder:'已保存 API Key；留空可继续使用'
  },
  'zh-TW': {
    title:'API 設定', intro:'支援 OpenAI、Claude 原生 API，以及 Chat Completions 相容介面與本機服務。', profiles:'API / 模型設定檔', profile:'目前設定', profileName:'設定名稱', newProfile:'新增設定', deleteProfile:'刪除目前設定', profileHint:'每個設定檔分別保存介面、模型與 API Key 儲存方式；切換後立即作為目前模型使用。', cannotDeleteLast:'至少保留一個設定檔。', endpoint:'介面完整網址', model:'模型名稱', apiKey:'API Key', keyStorage:'API Key 儲存方式',
    sessionOnly:'只保存在目前瀏覽器工作階段中（建議）', localPlain:'儲存在本機，瀏覽器重新啟動後自動可用', encryptedLocal:'使用密碼加密後儲存在本機',
    passphrase:'加密密碼', confirmPassphrase:'確認加密密碼', unlock:'解鎖已儲存的 Key', lock:'立即鎖定',
    securityWarning:'建議使用「僅本次工作階段」。選擇「儲存在本機」會把 API Key 持久儲存在擴充功能的本機儲存空間中，使用方便，但並不是安全保險箱。密碼加密可避免 Key 以明文持久儲存，但瀏覽器重新啟動後需要再次解鎖。任何方式都無法抵禦已控制瀏覽器、系統或擴充功能執行環境的惡意程式；請勿在公用裝置上儲存 Key。',
    reduceReasoning:'關閉思考（不支援關閉的模型使用最低強度）', save:'儲存設定', test:'測試 API', saved:'設定已儲存。', localSaved:'API Key 已儲存在本機。', encryptedSaved:'API Key 已加密儲存在本機；密碼沒有被儲存。', testing:'正在測試…', testFailed:'API 測試失敗。', testSuccess:'測試成功', remoteHttps:'遠端介面必須使用 HTTPS；HTTP 僅允許 localhost/127.0.0.1。', needModel:'請填寫模型名稱。', needKey:'請填寫 API Key，或使用目前已儲存/已解鎖的 Key。', badConfidence:'信心值必須介於 0 和 1 之間。', permissionDenied:'未取得存取該 API 網域的權限。', passMismatch:'兩次輸入的加密密碼不一致。', passRequired:'請輸入加密密碼。', unlocked:'已解鎖，本次瀏覽器工作階段可使用此 API Key。', locked:'已鎖定，本次工作階段中的明文 API Key 已清除。', noEncrypted:'找不到已加密儲存的 API Key。', unlockFailed:'解鎖失敗，請檢查密碼。', encryptedPlaceholder:'已加密儲存；輸入密碼後可解鎖', sessionPlaceholder:'輸入 API Key', savedPlaceholder:'API Key 已儲存；留空可繼續使用'
  },
  ja: {
    title:'API 設定', intro:'OpenAI・Claude のネイティブ API、Chat Completions 互換 API、ローカルサービスに対応しています。', endpoint:'API エンドポイント', model:'モデル名', apiKey:'API Key', keyStorage:'API Key の保存方法',
    sessionOnly:'現在のブラウザーセッションだけに保存（推奨）', localPlain:'ローカルに保存し、ブラウザー再起動後も自動で使用', encryptedLocal:'パスフレーズで暗号化してローカル保存',
    passphrase:'暗号化パスフレーズ', confirmPassphrase:'パスフレーズを確認', unlock:'保存済み Key を解除', lock:'今すぐロック',
    securityWarning:'「現在のセッションだけ」を推奨します。「ローカルに保存」は便利ですが、API Key を拡張機能のローカルストレージに永続保存するため、安全な金庫ではありません。パスフレーズ暗号化では平文での永続保存を避けられますが、ブラウザー再起動後に再度解除が必要です。どの方式でも、ブラウザー・OS・拡張機能の実行環境を支配したマルウェアからは保護できません。共有端末には Key を保存しないでください。',
    reduceReasoning:'思考を無効化（無効化できないモデルは最小強度）', save:'設定を保存', test:'API をテスト', saved:'設定を保存しました。', localSaved:'API Key をローカルに保存しました。', encryptedSaved:'API Key を暗号化して保存しました。パスフレーズは保存されません。', testing:'テスト中…', testFailed:'API テストに失敗しました。', testSuccess:'テスト成功', remoteHttps:'リモート API は HTTPS が必須です。HTTP は localhost/127.0.0.1 のみ許可されます。', needModel:'モデル名を入力してください。', needKey:'API Key を入力するか、保存済み/解除済みの Key を使用してください。', badConfidence:'信頼度は 0～1 の範囲で指定してください。', permissionDenied:'この API ドメインへのアクセス権限がありません。', passMismatch:'2回入力したパスフレーズが一致しません。', passRequired:'暗号化パスフレーズを入力してください。', unlocked:'解除しました。このブラウザーセッションで API Key を利用できます。', locked:'ロックしました。セッション内の平文 API Key を削除しました。', noEncrypted:'暗号化保存された API Key がありません。', unlockFailed:'解除に失敗しました。パスフレーズを確認してください。', encryptedPlaceholder:'暗号化保存済み。パスフレーズで解除できます', sessionPlaceholder:'API Key を入力', savedPlaceholder:'API Key は保存済みです。空欄のまま継続できます'
  },
  ko: {
    title:'API 설정', intro:'OpenAI 및 Claude 기본 API, Chat Completions 호환 API와 로컬 서비스를 지원합니다.', endpoint:'API 전체 주소', model:'모델 이름', apiKey:'API Key', keyStorage:'API Key 저장 방식',
    sessionOnly:'현재 브라우저 세션에만 저장(권장)', localPlain:'로컬에 저장하여 브라우저 재시작 후 자동 사용', encryptedLocal:'암호로 암호화하여 로컬에 저장',
    passphrase:'암호화 암호', confirmPassphrase:'암호 확인', unlock:'저장된 Key 잠금 해제', lock:'지금 잠그기',
    securityWarning:'“현재 세션에만 저장”을 권장합니다. “로컬에 저장”은 편리하지만 API Key를 확장 프로그램의 로컬 저장소에 영구 저장하므로 안전 금고가 아닙니다. 암호화 저장은 Key가 평문으로 영구 저장되는 것을 막지만 브라우저 재시작 후 다시 잠금을 해제해야 합니다. 어떤 방식도 브라우저·운영체제·확장 프로그램 실행 환경을 장악한 악성 프로그램을 막을 수 없습니다. 공용 기기에는 Key를 저장하지 마세요.',
    reduceReasoning:'사고 끄기 (끄기 불가능한 모델은 최소 강도)', save:'설정 저장', test:'API 테스트', saved:'설정을 저장했습니다.', localSaved:'API Key를 로컬에 저장했습니다.', encryptedSaved:'API Key를 암호화하여 로컬에 저장했습니다. 암호는 저장되지 않습니다.', testing:'테스트 중…', testFailed:'API 테스트에 실패했습니다.', testSuccess:'테스트 성공', remoteHttps:'원격 API는 HTTPS를 사용해야 합니다. HTTP는 localhost/127.0.0.1에서만 허용됩니다.', needModel:'모델 이름을 입력하세요.', needKey:'API Key를 입력하거나 현재 저장/잠금 해제된 Key를 사용하세요.', badConfidence:'신뢰도는 0과 1 사이여야 합니다.', permissionDenied:'이 API 도메인에 대한 접근 권한을 얻지 못했습니다.', passMismatch:'두 번 입력한 암호가 일치하지 않습니다.', passRequired:'암호화 암호를 입력하세요.', unlocked:'잠금을 해제했습니다. 현재 브라우저 세션에서 API Key를 사용할 수 있습니다.', locked:'잠갔습니다. 세션의 평문 API Key를 삭제했습니다.', noEncrypted:'암호화 저장된 API Key가 없습니다.', unlockFailed:'잠금 해제에 실패했습니다. 암호를 확인하세요.', encryptedPlaceholder:'암호화 저장됨; 암호로 잠금 해제', sessionPlaceholder:'API Key 입력', savedPlaceholder:'API Key가 저장되어 있습니다. 비워 두면 계속 사용합니다'
  },
  en: {
    title:'API Settings', intro:'Supports native OpenAI and Claude APIs, Chat Completions-compatible APIs, and local services.', profiles:'API / model profiles', profile:'Current profile', profileName:'Profile name', newProfile:'New profile', deleteProfile:'Delete current profile', profileHint:'Each profile stores its endpoint, model, and API Key storage independently. Switching profiles makes it active immediately.', cannotDeleteLast:'Keep at least one profile.', endpoint:'API endpoint', model:'Model name', apiKey:'API Key', keyStorage:'API Key storage',
    sessionOnly:'Store only for the current browser session (recommended)', localPlain:'Store locally and use automatically after browser restart', encryptedLocal:'Encrypt with a passphrase and store locally',
    passphrase:'Encryption passphrase', confirmPassphrase:'Confirm passphrase', unlock:'Unlock saved Key', lock:'Lock now',
    securityWarning:'“Current session only” is recommended. “Store locally” is convenient, but it persistently stores the API Key in extension local storage and is not a secure vault. Passphrase encryption avoids persistent plaintext storage, but you must unlock again after restarting the browser. No option can protect the Key from malware that already controls the browser, operating system, or extension runtime. Do not save a Key on a shared device.',
    reduceReasoning:'Disable thinking (lowest effort when disabling is unsupported)', save:'Save settings', test:'Test API', saved:'Settings saved.', localSaved:'API Key saved locally.', encryptedSaved:'API Key encrypted and stored locally. The passphrase was not saved.', testing:'Testing…', testFailed:'API test failed.', testSuccess:'Test successful', remoteHttps:'Remote APIs must use HTTPS. HTTP is allowed only for localhost/127.0.0.1.', needModel:'Enter a model name.', needKey:'Enter an API Key or use a currently saved/unlocked Key.', badConfidence:'Confidence must be between 0 and 1.', permissionDenied:'Permission to access this API domain was not granted.', passMismatch:'The two passphrases do not match.', passRequired:'Enter an encryption passphrase.', unlocked:'Unlocked. This API Key is available for the current browser session.', locked:'Locked. The plaintext API Key was removed from the current session.', noEncrypted:'No encrypted API Key is stored.', unlockFailed:'Unlock failed. Check the passphrase.', encryptedPlaceholder:'Encrypted Key saved; enter passphrase to unlock', sessionPlaceholder:'Enter API Key', savedPlaceholder:'API Key is already saved; leave blank to keep using it'
  }
};

let locale = 'zh-CN';
let keyState = { hasSession:false, hasLocal:false, hasEncrypted:false };
let profiles = {};
let activeProfileId = '';
let sessionKeys = {};
const MODEL_STRINGS = {
  'zh-CN':{providerLabel:'服务商',modelChoice:'模型',effortLabel:'思考强度',customModel:'自定义模型',modelDocs:'官方文档',reduceReasoning:'关闭思考',requiredThinking:'此模型必须思考；可选强度：',toggleThinking:'此模型支持关闭思考。',unknownThinking:'未知模型：使用服务端默认思考设置。'},
  'zh-TW':{providerLabel:'服務商',modelChoice:'模型',effortLabel:'思考強度',customModel:'自訂模型',modelDocs:'官方文件',reduceReasoning:'關閉思考',requiredThinking:'此模型必須思考；可選強度：',toggleThinking:'此模型支援關閉思考。',unknownThinking:'未知模型：使用伺服器預設思考設定。'},
  ja:{providerLabel:'プロバイダー',modelChoice:'モデル',effortLabel:'思考の強度',customModel:'カスタムモデル',modelDocs:'公式ドキュメント',reduceReasoning:'思考を無効にする',requiredThinking:'このモデルは思考が必須です。対応する強度：',toggleThinking:'このモデルは思考を無効にできます。',unknownThinking:'不明なモデル：サーバーの既定の思考設定を使用します。'},
  ko:{providerLabel:'제공업체',modelChoice:'모델',effortLabel:'추론 강도',customModel:'사용자 지정 모델',modelDocs:'공식 문서',reduceReasoning:'추론 끄기',requiredThinking:'이 모델은 추론이 필수입니다. 지원 강도: ',toggleThinking:'이 모델은 추론을 끌 수 있습니다.',unknownThinking:'알 수 없는 모델: 서버의 기본 추론 설정을 사용합니다.'},
  en:{providerLabel:'Provider',modelChoice:'Model',effortLabel:'Reasoning effort',customModel:'Custom model',modelDocs:'Official documentation',reduceReasoning:'Disable thinking',requiredThinking:'Thinking is required. Supported efforts: ',toggleThinking:'This model supports disabling thinking.',unknownThinking:'Unknown model: use the server’s default thinking settings.'}
};
for(const [language,strings] of Object.entries(MODEL_STRINGS))Object.assign(STRINGS[language],strings);

const DIRECTORY_STRINGS = {
  en:{localReasoningProtocol:'Reasoning parameter format',localReasoningSetting:'Reasoning setting',localReasoningHint:'Choose a format supported by the server version and model template.',localReasoningOff:'Off',localReasoningOn:'On',reasoningControlsUnknown:'This model supports reasoning. Its controls are unverified; the server default applies.',modelDeveloper:'Model developer',allDevelopers:'All developers',currentModel:'Current model',reasoningCapability:'Reasoning',reasoningSupported:'Supported',reasoningRequired:'Required',reasoningUnavailable:'Unavailable',refreshModelsDev:'Refresh Models.dev metadata',modelsDevReference:'Models.dev reference · account access unverified',noEndpoint:'No endpoint configured',serverDefault:'Server default',routerAdvanced:'OpenRouter advanced parameters',routerAdvancedHint:'JSON · only parameters advertised by the model are sent',providerReference:'Model reference configuration',providerReferenceUrl:'HTTPS configuration URL',updateProviderReference:'Update reference configuration',rollbackProviderReference:'Roll back configuration',remoteReference:'Remote reference · account access unverified',routerThinking:'Reasoning support varies by endpoint; some models cannot disable it.',refreshProviderModels:'Refresh current channel',refreshRouterProviders:'Refresh inference providers',refreshAllModels:'Refresh all models',modelSearch:'Search model name or ID',routerMode:'OpenRouter routing',
    routeBalanced:'Balanced',routePrice:'Lowest price',routeThroughput:'Fastest generation',routeLatency:'Lowest latency',routeOnly:'Specific provider',
    routerSearch:'Search inference providers',routerProvider:'Inference provider',localServiceHint:'API Key is optional. For a service on another device, enter that device’s private network address.',
    ollamaDetails:'Load Ollama model details',loadingDirectory:'Refreshing…',unknown:'Unknown',chooseProvider:'Select a provider',
    serviceSource:'Service API',publicSource:'Public API',referenceSource:'Bundled reference · account access unverified',directoryFailure:'Refresh failed',resultsLimited:'Showing up to 200 matching models',contextLength:'Context',supportedParameters:'Parameters',price:'Price',capabilities:'Capabilities'},
  'zh-CN':{localReasoningProtocol:'思考参数格式',localReasoningSetting:'思考开关或强度',localReasoningHint:'按服务版本和模型模板选择参数。默认沿用服务端设置。',localReasoningOff:'关闭',localReasoningOn:'开启',reasoningControlsUnknown:'该模型支持思考，开关和强度参数尚未确认，使用服务端默认设置。',modelDeveloper:'模型厂商',allDevelopers:'全部厂商',currentModel:'当前模型',reasoningCapability:'思考能力',reasoningSupported:'支持',reasoningRequired:'必需',reasoningUnavailable:'不支持',refreshModelsDev:'更新 Models.dev 补充信息',modelsDevReference:'Models.dev 参考 · 未核验账户权限',noEndpoint:'未配置接口地址',serverDefault:'服务端默认',routerAdvanced:'OpenRouter 高级参数',routerAdvancedHint:'JSON（仅发送模型目录支持的参数）',providerReference:'模型参考配置',providerReferenceUrl:'HTTPS 配置地址',updateProviderReference:'更新参考配置',rollbackProviderReference:'回滚配置',remoteReference:'远程参考 · 未核验账户权限',routerThinking:'思考能力取决于推理端点，部分模型无法关闭思考。',refreshProviderModels:'刷新当前渠道',refreshRouterProviders:'刷新推理供应商',refreshAllModels:'刷新全部模型',modelSearch:'搜索模型名称或 ID',routerMode:'OpenRouter 路由',
    routeBalanced:'均衡',routePrice:'最低价格',routeThroughput:'最快生成',routeLatency:'最低延迟',routeOnly:'指定供应商',
    routerSearch:'搜索推理供应商',routerProvider:'推理供应商',localServiceHint:'API Key 可留空。若服务运行在另一台设备上，请填写该设备的局域网地址。',
    ollamaDetails:'读取 Ollama 模型详情',loadingDirectory:'正在刷新…',unknown:'未知',chooseProvider:'请选择供应商',
    serviceSource:'服务端 API',publicSource:'公开 API',referenceSource:'内置参考 · 未核验账户权限',directoryFailure:'刷新失败',resultsLimited:'最多显示 200 个匹配模型',contextLength:'上下文',supportedParameters:'支持参数',price:'价格',capabilities:'能力'}
};
for (const [language,strings] of Object.entries(DIRECTORY_STRINGS)) Object.assign(STRINGS[language],strings);

const t = key => STRINGS[locale]?.[key] || STRINGS.en[key] || key;
const {
  PROFILE_STORAGE_KEY,
  ACTIVE_PROFILE_KEY,
  SESSION_KEYS_KEY,
  normalizeProfile,
  makeProfile,
  migrateApiProfileState,
  nextProfileName
} = globalThis.KRA_API_PROFILES;

init().catch(showError);

async function init() {
  if (typeof chrome.storage?.local?.setAccessLevel === 'function') {
    await chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
  }
  if (typeof chrome.storage?.session?.setAccessLevel === 'function') {
    await chrome.storage.session.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
  }

  const [localState, sessionState] = await Promise.all([
    chrome.storage.local.get([PROFILE_STORAGE_KEY, ACTIVE_PROFILE_KEY, 'apiConfig', 'encryptedApiKey', 'localApiKey', 'persistentApiKey', 'uiSettings']),
    chrome.storage.session.get([SESSION_KEYS_KEY, 'apiKey'])
  ]);
  const migrated = migrateApiProfileState(localState, sessionState);
  profiles = migrated.profiles;
  activeProfileId = migrated.activeId;
  sessionKeys = migrated.sessionKeys;
  locale = normalizeLocale(localState.uiSettings?.uiLocale);
  uiLocale.value = locale;

  await persistProfileState(true);
  renderProfileSelect();
  loadActiveProfileIntoForm();
  applyLocale();
}

async function persistProfileState(cleanLegacy = false) {
  await Promise.all([
    chrome.storage.local.set({ [PROFILE_STORAGE_KEY]: profiles, [ACTIVE_PROFILE_KEY]: activeProfileId }),
    chrome.storage.session.set({ [SESSION_KEYS_KEY]: sessionKeys })
  ]);
  if (cleanLegacy) {
    await Promise.all([
      chrome.storage.local.remove(['apiConfig', 'persistentApiKey', 'localApiKey', 'encryptedApiKey']),
      chrome.storage.session.remove('apiKey')
    ]);
  }
}

function activeProfile() {
  return profiles[activeProfileId] || null;
}

function renderProfileSelect() {
  profileSelect.replaceChildren();
  for (const profile of Object.values(profiles)) {
    const option = document.createElement('option');
    option.value = profile.id;
    option.textContent = profile.name || profile.id;
    profileSelect.append(option);
  }
  profileSelect.value = activeProfileId;
  deleteProfileButton.disabled = Object.keys(profiles).length <= 1;
}

function refreshKeyState() {
  const profile = activeProfile() || {};
  keyState = {
    hasSession: Boolean(sessionKeys[activeProfileId]),
    hasLocal: Boolean(profile.localApiKey),
    hasEncrypted: Boolean(profile.encryptedApiKey)
  };
}

function loadActiveProfileIntoForm() {
  const profile = activeProfile();
  if (!profile) return;
  profileNameInput.value = profile.name || '';
  endpointInput.value = profile.endpoint || '';
  modelInput.value = profile.model || '';
  disableThinkingInput.checked = profile.disableThinking ?? true;
  const provider=profile.provider||catalog?.inferProvider(profile.endpoint)||'custom';
  providerInput.replaceChildren(...(catalog?.providers||[{id:'custom',label:'Custom',models:[]}]).map(item=>new Option(item.label,item.id)));
  providerInput.value=Array.from(providerInput.options).some(option=>option.value===provider)?provider:'custom';
  directoryEntry = null;
  ollamaDetail = null;
  providerReference = null;
  publicModelMetadata = [];
  if (registry) {
    routerDeveloperFilter=null;
    element('modelSearch').value = '';
    element('routerMode').value = profile.routerMode;
    element('routerAdvanced').value = Object.keys(profile.routerAdvanced||{}).length ? JSON.stringify(profile.routerAdvanced) : '';
    element('routerSearch').value = '';
    routerProviderParameters=profile.routerProviderParameters;
    resetRouterProviders(profile.routerProviderModel === profile.model ? profile.routerProvider : '');
    syncProviderControls();
    refreshLocalReasoning(profile.localReasoningMode,profile.localReasoningValue);
  }
  refreshModelChoices(profile.model);
  refreshThinkingControls(profile.reasoningEffort);
  let mode = ['session','local','encrypted'].includes(profile.keyStorageMode) ? profile.keyStorageMode : 'session';
  if (mode === 'local' && !profile.localApiKey) mode = 'session';
  if (mode === 'encrypted' && !profile.encryptedApiKey) mode = 'session';
  setStorageMode(mode);
  apiKeyInput.value = '';
  passphraseInput.value = '';
  confirmPassphraseInput.value = '';
  refreshKeyState();
  updateKeyPlaceholder();
  if (registry) loadSelectedDirectory().catch(showError);
}

function refreshModelChoices(selected=modelInput.value) {
  const provider=catalog?.providers.find(item=>item.id===providerInput.value);
  const models=directoryEntry?.models || [...new Map([
    ...(provider?.models||[]).map(model=>({...model,source:'bundled-reference'})),...(providerReference?.models||[])
  ].map(model=>[model.id,model])).values()];
  const search=element('modelSearch')?.value.trim().toLowerCase() || '';
  const selectedModel=models.find(item=>item.id===selected);
  const developerSelect=element('routerDeveloper');
  const isRouter=provider?.id==='openrouter' && developerSelect;
  const developerOf=model=>model.developer || ' unknown';
  let developerFilter='';
  if(developerSelect){
    element('routerDeveloperRow').hidden=!isRouter;
    if(isRouter){
      const developers=[...new Set(models.map(developerOf))].sort((a,b)=>a.localeCompare(b));
      developerFilter=routerDeveloperFilter ?? (selectedModel ? developerOf(selectedModel) : '');
      if(!developers.includes(developerFilter))developerFilter='';
      developerSelect.replaceChildren(new Option(t('allDevelopers'),''),
        ...developers.map(id=>new Option(id===' unknown'?t('unknown'):id,id)));
      developerSelect.value=developerFilter;
    }
  }
  const matches=models.filter(item=>(!developerFilter || developerOf(item)===developerFilter) &&
    (!search || [item.id,item.label,item.developer].some(value=>value?.toLowerCase().includes(search))));
  const groups=new Map();
  for(const model of matches.slice(0,200)){
    const groupName=developerFilter ? '' : model.developer || (directoryEntry ? t('unknown') : '');
    if(!groups.has(groupName))groups.set(groupName,[]);
    groups.get(groupName).push(model);
  }
  const options=[];
  if(selectedModel && !matches.slice(0,200).includes(selectedModel)){
    const outsideDeveloper=developerFilter && developerOf(selectedModel)!==developerFilter;
    const option=new Option(outsideDeveloper ? t('currentModel')+' · '+selectedModel.label : selectedModel.label,selectedModel.id);
    option.disabled=Boolean(outsideDeveloper);
    options.push(option);
  }
  for(const [label,items] of groups){
    const rows=items.map(model=>new Option(model.label===model.id ? model.id : model.label+' · '+model.id,model.id));
    if(!label){options.push(...rows);continue;}
    const group=document.createElement('optgroup');
    group.label=label;group.append(...rows);options.push(group);
  }
  modelSelect.replaceChildren(...options,new Option(t('customModel'),'custom'));
  modelSelect.value=selectedModel?selected:'custom';
  document.querySelector('#customModelRow').hidden=modelSelect.value!=='custom';
  if(element('modelSearchRow')){
    element('modelSearchRow').hidden=models.length<10;
    modelSelect.title=matches.length>200?t('resultsLimited'):'';
  }
  renderDirectoryDetails();
}

const thinkingOffNotes={
 'zh-CN':'此模型仅关闭前置思考；无工具调用时直接回答。',
 'zh-TW':'此模型僅關閉前置思考；無工具呼叫時直接回答。',
 ja:'このモデルは事前の思考のみを無効化します。ツールなしでは直接回答します。',
 ko:'이 모델은 사전 추론만 끕니다. 도구가 없으면 바로 답합니다.',
 en:'Disables up-front thinking only; answers directly when no tools are used.'
};

const qwenNotes={
 'zh-CN':'百炼接口和 API Key 须属于同一地域；可填写控制台提供的业务空间专属完整地址。',
 'zh-TW':'百煉介面和 API Key 須屬於同一地域；可填寫控制台提供的業務空間專屬完整網址。',
 en:'Use an endpoint and API Key from the same region. Workspace-specific full endpoints from the console are supported.',
 ja:'API キーとエンドポイントのリージョンを一致させてください。コンソールのワークスペース専用 URL にも対応します。',
 ko:'API Key와 엔드포인트의 리전을 일치시키세요. 콘솔의 워크스페이스 전용 전체 URL도 지원합니다.'
};
const hunyuanNotes={
 'zh-CN':'TokenHub 默认广州地域，海外账号请把接口改为 https://tokenhub-intl.tencentmaas.com/v1/chat/completions；API Key 与接入地域必须一致。',
 'zh-TW':'TokenHub 預設廣州區域；國際帳戶請改用 https://tokenhub-intl.tencentmaas.com/v1/chat/completions；API Key 與區域必須一致。',
 en:'TokenHub defaults to Guangzhou. For Singapore-based accounts use https://tokenhub-intl.tencentmaas.com/v1/chat/completions; the region must match the API key.',
 ja:'TokenHub は既定で広州地域です。シンガポール地域では https://tokenhub-intl.tencentmaas.com/v1/chat/completions を使い、キーと地域を一致させてください。',
 ko:'TokenHub 기본은 광저우 리전입니다. 싱가포르 리전은 https://tokenhub-intl.tencentmaas.com/v1/chat/completions 를 사용하고 API Key 리전을 맞추세요.'
};
const fixedThinkingNotes={
 'zh-CN':['此模型不使用思考模式。','此模型始终开启思考。'],
 'zh-TW':['此模型不使用思考模式。','此模型始終開啟思考。'],
 en:['This model does not use thinking mode.','Thinking is always enabled for this model.'],
 ja:['このモデルは思考モードを使用しません。','このモデルは常に思考モードを使用します。'],
 ko:['이 모델은 추론 모드를 사용하지 않습니다.','이 모델은 추론 모드가 항상 켜져 있습니다.']
};

function refreshThinkingControls(effort=effortInput.value) {
  let capability=catalog?.resolve({provider:providerInput.value,endpoint:endpointInput.value,model:modelInput.value});
  const discovered=selectedModelMetadata();
  if(discovered?.rule && ['toggle','required','none'].includes(discovered.rule.thinking) && Array.isArray(discovered.rule.efforts)){
    capability={...capability,...discovered.rule};
  }
  if(providerInput.value==='openrouter' && discovered?.parameters?.some(p=>['reasoning','reasoning_effort'].includes(p))){
    capability={thinking:discovered.thinking==='required'?'required':'toggle',efforts:['',...(discovered.efforts||registry.efforts)]};
  }
  if(providerInput.value==='ollama' && discovered?.thinking){
    capability={thinking:discovered.thinking==='supported'?'toggle':discovered.thinking,
      efforts:discovered.efforts?.length ? ['',...discovered.efforts] : []};
  }
  document.querySelector('#disableThinkingRow').hidden=capability?.thinking!=='toggle';
  if(capability?.thinking==='required')disableThinkingInput.checked=false;
  const efforts=capability?.efforts||[];
  effortInput.replaceChildren(...efforts.map(value=>new Option(value||t('serverDefault'),value)));
  effortInput.value=efforts.includes(effort)?effort:(efforts[0]||'');
  const note=document.querySelector('#modelCapabilityNote'),docs=document.querySelector('#modelDocs');
  note.textContent=capability?.offType==='between_tools'?(thinkingOffNotes[uiLocale.value]||thinkingOffNotes.en):capability?.thinking==='required'?t('requiredThinking')+efforts.join(' / '):capability?.thinking==='toggle'?t('toggleThinking'):t('unknownThinking');
  if(!capability && ['supported','toggle','required'].includes(discovered?.thinking)){
    note.textContent=t('reasoningControlsUnknown');
  }
  if(!capability && discovered?.thinking==='none'){
    note.textContent=(fixedThinkingNotes[uiLocale.value]||fixedThinkingNotes.en)[0];
  }
  if(capability?.thinking==='none')note.textContent=(fixedThinkingNotes[uiLocale.value]||fixedThinkingNotes.en)[0];
  if(capability?.thinking==='required'&&!efforts.length)note.textContent=(fixedThinkingNotes[uiLocale.value]||fixedThinkingNotes.en)[1];
  if(providerInput.value==='qwen')note.textContent+=' '+(qwenNotes[uiLocale.value]||qwenNotes.en);
  if(providerInput.value==='openrouter' && capability)note.textContent=t('routerThinking');
  if(providerInput.value==='hunyuan')note.textContent+=' '+(hunyuanNotes[uiLocale.value]||hunyuanNotes.en);
  docs.hidden=!capability?.docs;docs.textContent=t('modelDocs');if(capability?.docs)docs.href=capability.docs;else docs.removeAttribute('href');
  document.querySelector('#reasoningEffortRow').hidden=!capability||!efforts.length||(capability.thinking==='toggle'&&disableThinkingInput.checked);
}

providerInput.addEventListener('change',()=>{
  const provider=catalog?.providers.find(item=>item.id===providerInput.value);
  if(provider?.endpoint)endpointInput.value=provider.endpoint;
  directoryEntry=null;
  ollamaDetail=null;
  providerReference=null;
  publicModelMetadata=[];
  if(registry){
    routerDeveloperFilter=null;
    element('modelSearch').value='';
    element('routerMode').value='balanced';
    element('routerAdvanced').value='';
    apiKeyInput.value='';
    resetRouterProviders();
    syncProviderControls();
    refreshLocalReasoning('','');
    loadSelectedDirectory().then(()=>{
      if(provider?.id!=='openrouter' || providerInput.value!=='openrouter' || directoryEntry)return;
      return refreshDirectories(false);
    }).catch(showError);
  }
  if(provider?.models.length)modelInput.value=provider.models[0].id;
  disableThinkingInput.checked=true;
  refreshModelChoices();refreshThinkingControls('');
});
modelSelect.addEventListener('change',()=>{
  if(modelSelect.value!=='custom')modelInput.value=modelSelect.value;
  document.querySelector('#customModelRow').hidden=modelSelect.value!=='custom';
  disableThinkingInput.checked=true;refreshThinkingControls('');
  renderDirectoryDetails();
  if(registry){refreshLocalReasoning();modelChanged();}
});
modelInput.addEventListener('input',()=>refreshThinkingControls(''));
modelInput.addEventListener('change',()=>{refreshThinkingControls('');if(registry)modelChanged();});
apiKeyInput.addEventListener('input',()=>{
  try{apiKeyInput.dataset.origin=new URL(endpointInput.value).origin;}catch{delete apiKeyInput.dataset.origin;}
});
endpointInput.addEventListener('change',()=>{
  if(apiKeyInput.dataset.origin){
    let origin;
    try{origin=new URL(endpointInput.value).origin;}catch{}
    if(origin!==apiKeyInput.dataset.origin)apiKeyInput.value='';
  }
  refreshThinkingControls();
  if(registry)loadSelectedDirectory().catch(showError);
});
disableThinkingInput.addEventListener('change',()=>refreshThinkingControls());

profileSelect.addEventListener('change', async () => {
  const nextId = profileSelect.value;
  if (!profiles[nextId]) return;
  activeProfileId = nextId;
  await persistProfileState(false);
  loadActiveProfileIntoForm();
  status.textContent = '';
});

newProfileButton.addEventListener('click', async () => {
  const id = `profile-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const profile = makeProfile(id, nextProfileName(profiles));
  profiles[id] = profile;
  activeProfileId = id;
  await persistProfileState(false);
  renderProfileSelect();
  loadActiveProfileIntoForm();
  profileNameInput.focus();
  profileNameInput.select();
  status.textContent = '';
});

deleteProfileButton.addEventListener('click', async () => {
  if (Object.keys(profiles).length <= 1) {
    status.textContent = t('cannotDeleteLast');
    return;
  }
  delete profiles[activeProfileId];
  delete sessionKeys[activeProfileId];
  activeProfileId = Object.keys(profiles)[0];
  await persistProfileState(false);
  renderProfileSelect();
  loadActiveProfileIntoForm();
  status.textContent = '';
});

uiLocale.addEventListener('change', async () => {
  locale = normalizeLocale(uiLocale.value);
  applyLocale();
  const { uiSettings = {} } = await chrome.storage.local.get('uiSettings');
  await chrome.storage.local.set({ uiSettings: { ...uiSettings, uiLocale: locale } });
  chrome.runtime.sendMessage({ type:'REFRESH_CONTEXT_MENU' }).catch(() => {});
});
for (const input of storageModeInputs) input.addEventListener('change', () => { syncEncryptedControls(); updateKeyPlaceholder(); });

saveButton.addEventListener('click', async () => {
  try {
    const config = await readFormForSave(false);
    await requestEndpointPermission(config.endpoint);
    await saveConfig(config);
    status.textContent = config.keyStorageMode === 'encrypted' ? t('encryptedSaved') : (config.keyStorageMode === 'local' ? t('localSaved') : t('saved'));
  } catch (error) { showError(error); }
});

testButton.addEventListener('click', async () => {
  try {
    if(registry && providerInput.value==='openrouter' && element('routerMode').value==='only')await refreshSelectedRouter(true);
    const config = await readFormForSave(true);
    await requestEndpointPermission(config.endpoint);
    await saveConfig(config);
    status.textContent = t('testing');
    const result = await chrome.runtime.sendMessage({ type:'TEST_API' });
    if (!result?.ok) throw new Error(result?.error || t('testFailed'));
    status.textContent = `${t('testSuccess')}: ${result.message || 'OK'}`;
  } catch (error) { showError(error); }
});

unlockButton.addEventListener('click', async () => {
  try {
    const profile = activeProfile();
    if (!profile?.encryptedApiKey) throw new Error(t('noEncrypted'));
    const passphrase = passphraseInput.value;
    if (!passphrase) throw new Error(t('passRequired'));
    const apiKey = await decryptApiKey(profile.encryptedApiKey, passphrase);
    sessionKeys[activeProfileId] = apiKey;
    await chrome.storage.session.set({ [SESSION_KEYS_KEY]: sessionKeys });
    refreshKeyState();
    apiKeyInput.value = '';
    confirmPassphraseInput.value = '';
    status.textContent = t('unlocked');
    updateKeyPlaceholder();
  } catch (error) {
    console.warn(error);
    status.textContent = t('unlockFailed');
  }
});

lockButton.addEventListener('click', async () => {
  delete sessionKeys[activeProfileId];
  await chrome.storage.session.set({ [SESSION_KEYS_KEY]: sessionKeys });
  refreshKeyState();
  apiKeyInput.value = '';
  passphraseInput.value = '';
  confirmPassphraseInput.value = '';
  updateKeyPlaceholder();
  status.textContent = t('locked');
});

async function readFormForSave(requireUsableKey = false) {
  const provider=providerInput.value||'custom';
  const inputEndpoint = endpointInput.value.trim();
  const endpoint = registry ? registry.endpoint(inputEndpoint,provider) : inputEndpoint;
  const model = modelInput.value.trim();
  const typedApiKey = apiKeyInput.value.trim();
  const rule=selectedModelMetadata()?.rule;
  const capability=rule && ['toggle','required','none'].includes(rule.thinking) && Array.isArray(rule.efforts) ?
    rule : catalog?.resolve({provider:providerInput.value,endpoint,model});
  const disableThinking = capability?.thinking==='required'?false:disableThinkingInput.checked;
  const reasoningEffort=provider==='openrouter'||provider==='ollama'?effortInput.value:capability?.efforts?.includes(effortInput.value)&&!(capability.thinking==='toggle'&&disableThinking)?effortInput.value:'';
  let keyStorageMode = getStorageMode();
  const url = new URL(endpoint);
  const isAllowedHttp = url.protocol === 'http:' && (url.hostname === 'localhost' || url.hostname === '127.0.0.1');
  if (!registry && url.protocol !== 'https:' && !isAllowedHttp) throw new Error(t('remoteHttps'));
  if (!model) throw new Error(t('needModel'));

  const existing = activeProfile() || {};
  let sameOrigin=false;try{sameOrigin=new URL(existing.endpoint).origin===url.origin;}catch{}
  const originChanged=!sameOrigin;
  const optionalKey=registry ? registry.keyOptional(url,provider) : isAllowedHttp;
  if(optionalKey && originChanged && !typedApiKey)keyStorageMode='session';
  if(!optionalKey&&originChanged&&!typedApiKey&&(sessionKeys[activeProfileId]||existing.localApiKey||existing.encryptedApiKey))throw new Error('接口域名已改变，请输入新服务商的 API Key。 / Endpoint origin changed; enter a new API Key.');
  const apiKey = typedApiKey || (sameOrigin?(sessionKeys[activeProfileId] || existing.localApiKey || ''):'');
  const hasEncrypted = sameOrigin&&Boolean(existing.encryptedApiKey);
  if (!apiKey && !optionalKey && (requireUsableKey || keyStorageMode !== 'encrypted' || !hasEncrypted)) throw new Error(t('needKey'));

  let passphrase = '';
  let shouldEncrypt = false;
  if (keyStorageMode === 'encrypted') {
    shouldEncrypt = Boolean(typedApiKey) || !hasEncrypted;
    if (shouldEncrypt) {
      if (!apiKey) throw new Error(t('needKey'));
      passphrase = passphraseInput.value;
      const confirm = confirmPassphraseInput.value;
      if (!passphrase) throw new Error(t('passRequired'));
      if (passphrase !== confirm) throw new Error(t('passMismatch'));
    }
  }
  const routerMode=provider==='openrouter' ? element('routerMode').value : 'balanced';
  const routerAdvanced=provider==='openrouter' ? registry.advancedOptions(JSON.parse(element('routerAdvanced').value.trim()||'{}')) : {};
  const previous=activeProfile();
  const retainedProvider=previous?.routerProviderModel===model && previous.routerProvider===routerSelection;
  if(routerMode==='only' && !(routerModel===model && routerOptions.some(item=>item.id===routerSelection)) &&
     !(retainedProvider && !verifiedRouterProviders && !requireUsableKey))throw Error(t('chooseProvider'));
  const routerParameters=routerMode==='only' ? routerOptions.find(item=>item.id===routerSelection)?.parameters ??
    (retainedProvider ? routerProviderParameters : null) : null;
  return { localReasoningMode:element('localReasoningMode')?.value||'',localReasoningValue:element('localReasoningValue')?.value||'',routerMode, routerAdvanced, routerProviderParameters:routerParameters, routerProvider:routerMode==='only'?routerSelection:'', routerProviderModel:routerMode==='only'?model:'',endpoint:url.href, model, apiKey, typedApiKey, keyStorageMode, passphrase, shouldEncrypt, disableThinking, provider, reasoningEffort, originChanged };
}

async function requestEndpointPermission(endpoint) {
  const url = new URL(endpoint);
  const originPattern = `${url.protocol}//${url.hostname}/*`;
  // v1.1.56.2 requests web hosts in the manifest for cross-origin frames.
  // No optional permission prompt is necessary or valid for these hosts.
  const granted = await chrome.permissions.contains({origins:[originPattern]});
  if (!granted) throw new Error(t('permissionDenied')+' 请在浏览器的扩展详情中允许此扩展访问该网站。');
}

async function saveConfig(config) {
  const existing = activeProfile() || makeProfile(activeProfileId, 'Default');
  const name = profileNameInput.value.trim() || existing.name || 'Default';
  const next = normalizeProfile({
    ...existing,
    id: activeProfileId,
    name,
    endpoint: config.endpoint,
    model: config.model,
    keyStorageMode: config.keyStorageMode,
    disableThinking: config.disableThinking,
    provider: config.provider,
    reasoningEffort: config.reasoningEffort,
    routerMode:config.routerMode, routerAdvanced:config.routerAdvanced, routerProviderParameters:config.routerProviderParameters, routerProvider:config.routerProvider, routerProviderModel:config.routerProviderModel,
    localReasoningMode:config.localReasoningMode,localReasoningValue:config.localReasoningValue,
  }, activeProfileId, name);

  if(config.originChanged){delete sessionKeys[activeProfileId];next.localApiKey='';next.encryptedApiKey=null;}
  if (config.keyStorageMode === 'session') {
    next.localApiKey = '';
    next.encryptedApiKey = null;
    if (config.apiKey) sessionKeys[activeProfileId] = config.apiKey;
  } else if (config.keyStorageMode === 'local') {
    next.localApiKey = config.apiKey || '';
    next.encryptedApiKey = null;
    if (config.apiKey) sessionKeys[activeProfileId] = config.apiKey;
  } else {
    next.localApiKey = '';
    if (config.shouldEncrypt) next.encryptedApiKey = await encryptApiKey(config.apiKey, config.passphrase);
    if (config.apiKey) sessionKeys[activeProfileId] = config.apiKey;
  }

  profiles[activeProfileId] = next;
  await persistProfileState(true);
  renderProfileSelect();
  profileSelect.value = activeProfileId;
  refreshKeyState();
  apiKeyInput.value = '';
  passphraseInput.value = '';
  confirmPassphraseInput.value = '';
  updateKeyPlaceholder();
}

async function encryptApiKey(apiKey, passphrase) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const iterations = 310000;
  const keyMaterial = await crypto.subtle.importKey('raw', encoder.encode(passphrase), 'PBKDF2', false, ['deriveKey']);
  const key = await crypto.subtle.deriveKey({ name:'PBKDF2', hash:'SHA-256', salt, iterations }, keyMaterial, { name:'AES-GCM', length:256 }, false, ['encrypt']);
  const ciphertext = await crypto.subtle.encrypt({ name:'AES-GCM', iv, additionalData:encoder.encode('KRA_API_KEY_V1') }, key, encoder.encode(apiKey));
  return { version:1, kdf:'PBKDF2-SHA-256', iterations, salt:toBase64(salt), iv:toBase64(iv), ciphertext:toBase64(new Uint8Array(ciphertext)) };
}

async function decryptApiKey(payload, passphrase) {
  if (!payload || payload.version !== 1) throw new Error('Unsupported encrypted key format');
  const salt = fromBase64(payload.salt);
  const iv = fromBase64(payload.iv);
  const ciphertext = fromBase64(payload.ciphertext);
  const keyMaterial = await crypto.subtle.importKey('raw', encoder.encode(passphrase), 'PBKDF2', false, ['deriveKey']);
  const key = await crypto.subtle.deriveKey({ name:'PBKDF2', hash:'SHA-256', salt, iterations:Number(payload.iterations || 310000) }, keyMaterial, { name:'AES-GCM', length:256 }, false, ['decrypt']);
  const plain = await crypto.subtle.decrypt({ name:'AES-GCM', iv, additionalData:encoder.encode('KRA_API_KEY_V1') }, key, ciphertext);
  return decoder.decode(plain);
}
function toBase64(bytes) { let binary=''; for (const b of bytes) binary += String.fromCharCode(b); return btoa(binary); }
function fromBase64(value) { const binary=atob(value); const bytes=new Uint8Array(binary.length); for (let i=0;i<binary.length;i++) bytes[i]=binary.charCodeAt(i); return bytes; }

function getStorageMode() { return storageModeInputs.find(input => input.checked)?.value || 'session'; }
function setStorageMode(value) { const normalized = ['session','local','encrypted'].includes(value) ? value : 'session'; for (const input of storageModeInputs) input.checked = input.value === normalized; syncEncryptedControls(); }
function syncEncryptedControls() { encryptedControls.hidden = getStorageMode() !== 'encrypted'; }
function updateKeyPlaceholder() {
  const mode = getStorageMode();
  if (mode === 'encrypted' && keyState.hasEncrypted && !keyState.hasSession) apiKeyInput.placeholder = t('encryptedPlaceholder');
  else if ((mode === 'local' && keyState.hasLocal) || keyState.hasSession) apiKeyInput.placeholder = t('savedPlaceholder');
  else apiKeyInput.placeholder = t('sessionPlaceholder');
}
function normalizeLocale(value) { return ['zh-CN','zh-TW','ja','ko','en'].includes(value) ? value : 'zh-CN'; }
function applyLocale() {
  document.documentElement.lang = locale;
  document.title = t('title');
  for (const el of document.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);
  refreshModelChoices();refreshThinkingControls();
  if(registry)refreshLocalReasoning();
  updateKeyPlaceholder();
}
function showError(error) { status.textContent = error?.message || String(error); }

function directoryConfig(profile=activeProfile(),current=true) {
  const provider=current ? providerInput.value : registry.idOf(profile);
  const endpoint=current ? endpointInput.value.trim() : profile.endpoint;
  const model=current ? modelInput.value.trim() : profile.model;
  const url=new URL(registry.endpoint(endpoint,provider));
  const sameOrigin=profile?.endpoint && new URL(profile.endpoint).origin===url.origin;
  const apiKey=(current ? apiKeyInput.value.trim() : '') ||
    (sameOrigin ? sessionKeys[profile.id] || profile.localApiKey || '' : '');
  return {endpoint:url.href,provider,model,apiKey,profileId:profile?.id || ''};
}
function selectedModelMetadata() {
  const id=modelInput.value.trim();
  const reference=globalThis.KRA_PROVIDER_CONFIG?.modelRule(providerReference,id);
  const supplemental=publicModelMetadata.find(model=>model.id===id);
  const discovered=(ollamaDetail?.id===id ? ollamaDetail : null) || directoryEntry?.models.find(model=>model.id===id);
  if(discovered){
    const effective=globalThis.KRA_PROVIDER_CONFIG.mergeModelRule(reference,discovered);
    return {...supplemental,...effective,rule:effective,
    contextReference:discovered.contextLength==null && reference?.contextLength==null && supplemental?.contextLength!=null};
  }
  if(reference)return {...reference,rule:reference};
  if(supplemental)return supplemental;
  const bundled=registry?.get(providerInput.value).models.find(model=>model.id===id);
  return bundled ? {...bundled,source:'bundled-reference'} : null;
}
const directoryThinkingLabels={supported:'reasoningSupported',toggle:'reasoningSupported',required:'reasoningRequired',none:'reasoningUnavailable'};
function renderDirectoryDetails() {
  const view=element('directoryModelDetails');
  if(!view)return;
  const model=selectedModelMetadata();
  view.textContent=model ? [
    model.developer,
    model.inferenceProvider && `${t('routerProvider')}: ${model.inferenceProvider}`,
    model.source==='remote-reference' && t('remoteReference'),
    model.source==='models.dev' && t('modelsDevReference'),
    model.source==='bundled-reference' && t('referenceSource'),
    `${t('contextLength')}: ${model.contextLength ?? t('unknown')}${model.contextReference?' (Models.dev)':''}`,
    model.pricing && `${t('price')}${model.channel==='openrouter'?' (USD)':''}: ${JSON.stringify(model.pricing)}`,
    model.parameters && `${t('supportedParameters')}: ${model.parameters.join(', ')}`,
    directoryThinkingLabels[model.thinking] && `${t('reasoningCapability')}: ${t(directoryThinkingLabels[model.thinking])}`,
    (model.capabilities || model.architecture) && `${t('capabilities')}: ${JSON.stringify(model.capabilities || model.architecture)}`
  ].filter(Boolean).join(' · ') : '';
}
function refreshLocalReasoning(mode=element('localReasoningMode').value,value=element('localReasoningValue').value){
  const modes=registry.localReasoningModes(providerInput.value);
  const modeSelect=element('localReasoningMode');
  const valueSelect=element('localReasoningValue');
  const labels={native:'LM Studio REST',effort:'reasoning_effort',template:'chat_template_kwargs',metadata:'metadata'};
  element('localReasoningRow').hidden=!modes.length;
  modeSelect.replaceChildren(new Option(t('serverDefault'),''),...modes.map(item=>new Option(labels[item],item)));
  modeSelect.value=modes.includes(mode)?mode:'';
  const advertised=selectedModelMetadata()?.localReasoningOptions;
  const values=modeSelect.value==='native' && Array.isArray(advertised) ? advertised :
    registry.localReasoningValues(modeSelect.value);
  element('localReasoningValueRow').hidden=!values.length;
  valueSelect.replaceChildren(new Option(t('serverDefault'),''),...values.map(item=>
    new Option(item==='off'?t('localReasoningOff'):item==='on'?t('localReasoningOn'):item,item)));
  valueSelect.value=values.includes(value)?value:'';
}

function syncProviderControls() {
  const id=providerInput.value;
  element('routerSettings').hidden=id!=='openrouter';
  element('routerProvidersRow').hidden=element('routerMode').value!=='only';
  element('localSettings').hidden=!registry.local(id);
  element('ollamaModelDetails').hidden=id!=='ollama';
  endpointInput.readOnly=id==='openrouter';
}
function directorySummary(entry) {
  const source={ 'service-api':'serviceSource','public-api':'publicSource','bundled-reference':'referenceSource' }[entry.source];
  return `${t(source)} · ${entry.models.length} (+${entry.added}) · ${new Date(entry.updatedAt).toLocaleString(locale)}`;
}
function renderDirectoryStatuses() {
  const rows=[...refreshStatuses.values()];
  if(!rows.length && directoryEntry)rows.push(directorySummary(directoryEntry));
  element('directoryStatus').textContent=rows.join('\n');
}
async function loadSelectedDirectory() {
  const revision=++directoryRevision;
  directoryEntry=null;
  ollamaDetail=null;
  providerReference=null;
  publicModelMetadata=[];
  let config;
  try {config=directoryConfig();} catch {}
  if(!config){refreshModelChoices();renderDirectoryStatuses();return;}
  const [entry,detail,reference,publicMetadata]=await Promise.all([
    directory.load(config),config.provider==='ollama' ? directory.loadDetail(config) : null,
    globalThis.KRA_PROVIDER_CONFIG.channel(config.provider),
    globalThis.KRA_PROVIDER_CONFIG.publicMetadata(config.provider)
  ]);
  if(revision!==directoryRevision)return;
  directoryEntry=entry;
  ollamaDetail=detail;
  providerReference=reference;
  publicModelMetadata=publicMetadata;
  refreshModelChoices();
  refreshThinkingControls();
  refreshLocalReasoning();
  renderDirectoryStatuses();
}
async function refreshDirectory(config) {
  const key=JSON.stringify([config.provider,config.endpoint,config.profileId]);
  const label=registry.get(config.provider).label+(config.profileName ? ' / '+config.profileName : '');
  refreshStatuses.set(key,label+' · '+t('loadingDirectory'));
  renderDirectoryStatuses();
  try {
    await requestEndpointPermission(config.endpoint);
    const result=await directory.discover(config);
    refreshStatuses.set(key,label+' · '+directorySummary(result));
  } catch(error) {
    const previous=await directory.load(config);
    refreshStatuses.set(key,label+' · '+t('directoryFailure')+': '+error.message+(previous ? ' · '+directorySummary(previous) : ''));
  }
  renderDirectoryStatuses();
}
async function refreshDirectories(all) {
  const configs=new Map();
  const add=config=>configs.set(JSON.stringify([config.provider,config.endpoint,config.profileId]),config);
  try {add(directoryConfig());} catch(error) {if(!all)throw error;}
  if(all){
    const configured=new Set([...configs.values()].map(config=>config.provider));
    for(const profile of Object.values(profiles)){
      if(!profile.endpoint)continue;
      try {
        add({...directoryConfig(profile,false),profileName:profile.name});
        configured.add(registry.idOf(profile));
      } catch(error) {refreshStatuses.set(profile.id,profile.name+' · '+t('directoryFailure')+': '+error.message);}
    }
    for(const provider of registry.providers){
      if(configured.has(provider.id))continue;
      if(!provider.endpoint){
        refreshStatuses.set(provider.id,provider.label+' · '+t('noEndpoint'));
        continue;
      }
      add({provider:provider.id,endpoint:registry.endpoint(provider.endpoint,provider.id),profileId:'',apiKey:''});
    }
  }
  const buttons=[element('refreshAllModels'),element('refreshProviderModels')];
  buttons.forEach(button=>{button.disabled=true;});
  try {
    const jobs=[...configs.values()].map(refreshDirectory);
    if(all){
      const config=globalThis.KRA_PROVIDER_CONFIG;
      const refreshReference=async (label,run)=>{
        try{
          const result=await run();
          if(result!==null)refreshStatuses.set(label,label+' · '+result);
        }catch(error){
          refreshStatuses.set(label,label+' · '+t('directoryFailure')+': '+error.message);
        }
      };
      jobs.push(refreshReference('Models.dev',config.refreshPublicCatalog),
        refreshReference(t('providerReference'),config.refreshRules));
    }
    await Promise.all(jobs);
    await loadSelectedDirectory();
  } finally {buttons.forEach(button=>{button.disabled=false;});}
}
function resetRouterProviders(selection='') {
  routerRevision++;
  routerOptions=[];
  routerModel='';
  routerSelection=selection;
  if(!selection)routerProviderParameters=null;
  verifiedRouterProviders=false;
  renderRouterProviders();
}
function renderRouterProviders() {
  const select=element('routerProvider');
  const search=element('routerSearch').value.trim().toLowerCase();
  const options=routerOptions.filter(item=>item.id===routerSelection || (item.label+' '+item.id).toLowerCase().includes(search));
  const retained=routerSelection && !verifiedRouterProviders && !options.some(item=>item.id===routerSelection);
  select.replaceChildren(new Option(t('chooseProvider'),''),
    ...(retained ? [new Option(routerSelection,routerSelection)] : []),
    ...options.map(item=>new Option(item.label+' · '+item.id,item.id)));
  select.value=retained || options.some(item=>item.id===routerSelection) ? routerSelection : '';
}
async function refreshSelectedRouter(throwOnFailure=false) {
  if(providerInput.value!=='openrouter'||element('routerMode').value!=='only')return;
  const model=modelInput.value.trim();
  const revision=++routerRevision;
  const view=element('routerStatus');
  if(!model){view.textContent=t('needModel');return;}
  view.textContent=t('loadingDirectory');
  try {
    const config=directoryConfig();
    await requestEndpointPermission(config.endpoint);
    const options=await directory.inferenceProviders(model,config.apiKey);
    if(revision!==routerRevision || model!==modelInput.value.trim())return;
    routerOptions=options;
    routerModel=model;
    verifiedRouterProviders=true;
    if(!options.some(item=>item.id===routerSelection))routerSelection='';
    renderRouterProviders();
    view.textContent=`${options.length} · ${new Date().toLocaleTimeString(locale)}`;
  } catch(error) {
    if(revision!==routerRevision)return;
    view.textContent=t('directoryFailure')+': '+error.message;
    if(throwOnFailure)throw error;
  }
}
function modelChanged() {
  const selection=routerModel===modelInput.value.trim() ? routerSelection : '';
  resetRouterProviders(selection);
  refreshSelectedRouter();
  if(providerInput.value==='ollama')loadSelectedDirectory().catch(showError);
}

if(registry){
  globalThis.KRA_PROVIDER_CONFIG.sourceUrl().then(url=>{
    const input=element('providerReferenceUrl');
    if(!input.value)input.value=url;
  }).catch(showError);
  let updatingReference=false;
  const changeReference=async update=>{
    if(updatingReference)return;
    updatingReference=true;
    try{
      const config=globalThis.KRA_PROVIDER_CONFIG;
      const version=update ? await config.update(element('providerReferenceUrl').value.trim()) : await config.rollback();
      status.textContent=t('providerReference')+' · v'+version;
      await loadSelectedDirectory();
    }catch(error){showError(error);}
    finally{updatingReference=false;}
  };
  element('updateProviderReference').addEventListener('click',()=>changeReference(true));
  element('rollbackProviderReference').addEventListener('click',()=>changeReference(false));
  element('refreshModelsDev').addEventListener('click',async event=>{
    const button=event.currentTarget;
    button.disabled=true;
    status.textContent=t('loadingDirectory');
    try{
      const count=await globalThis.KRA_PROVIDER_CONFIG.refreshPublicCatalog();
      status.textContent=`Models.dev · ${count} · ${new Date().toLocaleString(locale)}`;
      await loadSelectedDirectory();
    }catch(error){showError(error);}
    finally{button.disabled=false;}
  });
  element('refreshProviderModels').addEventListener('click',()=>refreshDirectories(false).catch(showError));
  element('refreshAllModels').addEventListener('click',()=>{refreshStatuses.clear();refreshDirectories(true).catch(showError);});
  element('localReasoningMode').addEventListener('change',event=>refreshLocalReasoning(event.target.value,''));
  element('routerDeveloper').addEventListener('change',event=>{
    routerDeveloperFilter=event.target.value;
    element('modelSearch').value='';
    refreshModelChoices();
  });
  element('modelSearch').addEventListener('input',()=>refreshModelChoices());
  element('routerMode').addEventListener('change',()=>{syncProviderControls();refreshSelectedRouter();});
  element('routerProvider').addEventListener('change',event=>{routerSelection=event.target.value;});
  element('routerSearch').addEventListener('input',renderRouterProviders);
  element('refreshRouterProviders').addEventListener('click',()=>refreshSelectedRouter());
  element('ollamaModelDetails').addEventListener('click',async()=>{
    try{
      const config=directoryConfig();
      if(!config.model)throw Error(t('needModel'));
      await requestEndpointPermission(config.endpoint);
      const detail=await directory.refreshDetail(config);
      if(providerInput.value!=='ollama'||modelInput.value.trim()!==config.model||activeProfileId!==config.profileId||directoryConfig().endpoint!==config.endpoint)return;
      ollamaDetail=detail;
      refreshThinkingControls();
      renderDirectoryDetails();
    }catch(error){showError(error);}
  });
}
