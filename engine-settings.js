import {readDictionaryInfo,importBrowserDictionary,clearBrowserDictionary} from './browser-engine.js';
import {normalizeBatchContextTier} from './batch-budget.js';
const copy={
 en:{title:'Browser dictionary engine',model:'Enable optional model review (off by default)',instructions:'The algorithm runs entirely inside this extension. No Python server, pairing token or startup script is required.',download:'Download official Korean dictionary JSON ZIP',import:'Import the official JSON ZIP without extracting, or a hanja_dict.db built on your computer to skip ZIP parsing and database construction.',file:'Dictionary ZIP or database',importButton:'Import dictionary',clear:'Remove dictionary',save:'Save settings',saved:'Settings saved.',ready:'Ready',missing:'Select a dictionary file above, then click Import dictionary.',busy:'Importing dictionary… Keep this settings page open.',removed:'Dictionary removed.'},
 'zh-CN':{title:'浏览器内词典引擎',model:'启用可选模型审核（默认关闭）',instructions:'算法全部在插件内运行，无需 Python 服务器、配对令牌或启动脚本。',download:'下载官方韩语词典 JSON ZIP',import:'可直接导入官方 JSON ZIP；手机也可选择电脑预处理生成的 hanja_dict.db，省去解压、解析和建库。不同词典快照的结果可能不同。',file:'词典文件（ZIP 或数据库）',importButton:'导入词典',clear:'移除词典',save:'保存设置',saved:'设置已保存。',ready:'就绪',missing:'请先选择上方的词典文件，再点击“导入词典”。',busy:'正在导入词典… 请保持设置页面打开。',removed:'词典已移除。'},
 'zh-TW':{title:'瀏覽器內詞典引擎',model:'啟用可選模型審核（預設關閉）',instructions:'演算法全部在擴充功能內執行，無需 Python 伺服器、配對權杖或啟動腳本。',download:'下載官方韓語詞典 JSON ZIP',import:'可匯入官方 JSON ZIP，或電腦預處理產生的 hanja_dict.db，省去解壓縮、解析及建庫。不同詞典快照的結果可能不同。',file:'詞典檔案（ZIP 或資料庫）',importButton:'匯入詞典',clear:'移除詞典',save:'儲存設定',saved:'設定已儲存。',ready:'就緒',missing:'請先選擇上方的詞典檔案，再點擊「匯入詞典」。',busy:'正在匯入詞典… 請保持設定頁面開啟。',removed:'詞典已移除。'},
 ja:{title:'ブラウザー内辞書エンジン',model:'任意のモデル審査を有効化（初期設定は無効）',instructions:'アルゴリズムは拡張機能内で動作します。Python サーバーや起動スクリプトは不要です。',download:'公式韓国語辞書 JSON ZIP をダウンロード',import:'公式 JSON ZIP、またはパソコンで作成した hanja_dict.db を取り込めます。データベース形式では ZIP の解析と構築を省略します。',file:'辞書 ZIP またはデータベース',importButton:'辞書を取り込む',clear:'辞書を削除',save:'設定を保存',saved:'設定を保存しました。',ready:'準備完了',missing:'先に上の辞書ファイルを選択してから、取り込みを押してください。',busy:'辞書を取り込み中… このページを開いたままにしてください。',removed:'辞書を削除しました。'},
 ko:{title:'브라우저 사전 엔진',model:'선택적 모델 검토 사용 (기본 꺼짐)',instructions:'알고리즘이 확장 프로그램 안에서 실행됩니다. Python 서버나 시작 스크립트가 필요하지 않습니다.',download:'공식 한국어 사전 JSON ZIP 다운로드',import:'공식 JSON ZIP 또는 컴퓨터에서 만든 hanja_dict.db를 가져올 수 있습니다. DB 형식은 ZIP 분석과 사전 구축을 생략합니다.',file:'사전 ZIP 또는 데이터베이스',importButton:'사전 가져오기',clear:'사전 삭제',save:'설정 저장',saved:'설정이 저장되었습니다.',ready:'준비됨',missing:'위에서 사전 파일을 선택한 다음 가져오기를 누르세요。',busy:'사전 가져오는 중… 이 페이지를 닫지 마세요.',removed:'사전이 삭제되었습니다.'}
};
const $=id=>document.getElementById(id),status=$('engineStatus');
const reviewCopy={
 'zh-CN':['全部交给大模型审核（默认关闭）','开启后，本地只查词和定位，所有可标注的汉字词、外来语和混种词候选均由模型选义，也可保留韩文。自动启用模型审核，需配置 API；未返回有效结果的词保留韩文。仍需导入词典，未收录词不生成标注。请求量、费用和等待时间可能增加；下一次标注生效。'],
 'zh-TW':['全部交給大模型審核（預設關閉）','開啟後，本機只查詞和定位，所有可標註的漢字詞、外來語和混種詞候選均由模型選義，也可保留韓文。自動啟用模型審核，需設定 API；無有效結果時保留韓文。仍需匯入詞典，未收錄詞不產生標註。請求量、費用及等待時間可能增加；下次標註生效。'],
 en:['Review all candidates with the model (off by default)','Local processing only looks up and locates words; the model decides every eligible Hanja, loanword and mixed-origin candidate, including KEEP. Automatically enables model review and requires API configuration. Missing or invalid answers leave Korean unchanged. A dictionary is still required; unknown words are not annotated. Requests, cost and waiting time may increase. Applies to new tasks.'],
 ja:['すべての候補をモデルで審査（初期設定は無効）','ローカル処理は辞書検索と位置特定のみ行い、漢字語・外来語・混種語の全候補をモデルが判断します。韓国語のまま保持する選択も可能です。モデル審査を自動で有効化し、API設定と辞書が必要です。無効な回答や未収録語は韓国語のまま保持します。通信量・費用・待ち時間が増える場合があります。次の処理から適用。'],
 ko:['모든 후보를 모델로 검토 (기본 꺼짐)','로컬에서는 사전 검색과 위치 확인만 하며, 모든 한자어·외래어·혼종어 후보의 뜻을 모델이 선택하거나 한글로 유지합니다. 모델 검토가 자동 활성화되며 API 설정과 사전이 필요합니다. 유효한 답이 없거나 사전에 없는 단어는 한글로 유지합니다. 요청량·비용·대기 시간이 늘어날 수 있습니다. 새 작업부터 적용됩니다.']
};
for(const [locale,labels] of Object.entries(reviewCopy)){copy[locale].reviewAll=labels[0];copy[locale].reviewAllHint=labels[1];}
const manualCopy={
 'zh-CN':['手动聊天审核（复制提示词／粘贴结果）','默认关闭。开启后自动启用审核，并用网页上的手动面板代替 API：复制或下载提示词给聊天模型，再把完整 JSON 结果粘贴回来。不需要 API Key；仍需词典。可与“全部交给大模型审核”一起使用，否则仅处理待消歧候选。较多内容会分批，等待回填不限 API 超时时间；刷新或离开网页会取消任务。下一次标注生效。'],
 'zh-TW':['手動聊天審核（複製提示詞／貼上結果）','預設關閉。開啟後自動啟用審核，以網頁手動面板代替 API：複製或下載提示詞給聊天模型，再貼回完整 JSON。無需 API Key，仍需詞典。可搭配全部審核，否則只處理歧義候選。內容較多時分批；等候回填無 API 逾時限制，重新整理或離開頁面會取消。下次標註生效。'],
 en:['Manual chat review (copy prompt / paste result)','Off by default. Enables review and replaces API calls with an on-page panel: copy or download the prompt for a chat model, then paste its complete JSON answer. No API key is needed; a dictionary is required. Combine with Review all candidates to review locally certain words too. Larger tasks are split into batches. Waiting has no API timeout; reloading or leaving the page cancels the task. Applies to new tasks.'],
 ja:['手動チャット審査（プロンプトをコピー／結果を貼り付け）','初期設定は無効。審査を自動で有効化し、APIの代わりにページのパネルでプロンプトをコピー・保存してチャットモデルへ送り、完全なJSON結果を貼り付けます。APIキーは不要ですが辞書は必要です。全候補審査との併用も可能。多い場合は分割し、入力待ちにAPIのタイムアウトはありません。ページを離れるか再読み込みすると中止します。次の処理から適用。'],
 ko:['수동 채팅 검토 (프롬프트 복사 / 결과 붙여넣기)','기본 꺼짐. 검토를 자동 활성화하고 API 대신 페이지 패널에서 프롬프트를 복사·다운로드해 채팅 모델에 전달한 뒤 전체 JSON 결과를 붙여넣습니다. API 키는 필요 없지만 사전은 필요합니다. 모든 후보 검토와 함께 쓸 수 있습니다. 큰 작업은 나누며 입력 대기에 API 시간 제한은 없습니다. 페이지를 떠나거나 새로고침하면 취소됩니다. 새 작업부터 적용됩니다.']
};
for(const [locale,labels] of Object.entries(manualCopy)){copy[locale].manual=labels[0];copy[locale].manualHint=labels[1];}
const capacityCopy={
 'zh-CN':['每批上下文容量（API／手动）','当前（保留现有分批）','按共享池去重后的输入与预计 JSON 答案分批，另留窗口的 8% + 1024 tokens 余量。32K/128K/256K/512K/1M 不再受原来的固定词数和字符数限制，但答案长度预算仍可能使批次提前结束。token 数为通用估算，非服务商精确分词。请选择模型实际支持的窗口，手动聊天建议使用新对话。下一次标注生效。'],
 'zh-TW':['每批上下文容量（API／手動）','目前（保留原有分批）','依共享池去重後的輸入與預計 JSON 答案分批，另留視窗的 8% + 1024 tokens。32K/128K/256K/512K/1M 不受原有固定詞數與字元數限制，但答案長度預算仍可能提早分批。token 數為通用估算，非服務商精確分詞。請選模型支援的視窗，手動聊天建議使用新對話。下次任務生效。'],
 en:['Context capacity per batch (API / manual)','Current (keep existing batching)','Pack the deduplicated prompt plus estimated JSON answer, reserving another 8% of the window + 1024 tokens. 32K/128K/256K/512K/1M remove fixed word/character caps; reply-length budgets can still split earlier. Tokens are approximate, not provider-specific counts. Choose a supported context size; use a fresh chat for manual review. Applies to new tasks.'],
 ja:['バッチごとのコンテキスト容量（API／手動）','現在（従来の分割）','重複除去した入力とJSON回答を見積もり、別にウィンドウの8%＋1024トークンを確保します。32K/128K/256K/512K/1Mでは従来の語数・文字数上限を解除しますが、回答長の予算で早めに分割する場合があります。トークン数は概算です。対応する容量を選び、手動では新規チャットを推奨します。次の処理から適用。'],
 ko:['배치당 컨텍스트 용량 (API / 수동)','현재 (기존 분할 유지)','중복을 제거한 입력과 JSON 답변을 추정하고, 별도로 창의 8% + 1024토큰을 남깁니다. 32K/128K/256K/512K/1M은 기존 단어·문자 수 제한을 해제하지만 답변 길이 예산으로 일찍 나눌 수 있습니다. 토큰 수는 제공업체별 정확한 값이 아닌 추정치입니다. 지원하는 용량을 선택하고 수동 검토는 새 채팅을 권장합니다. 새 작업부터 적용됩니다.']
};
for(const [locale,labels] of Object.entries(capacityCopy)){Object.assign(copy[locale],{batchLabel:labels[0],batchCurrent:'32K',batch128k:'128K',batch256k:'256K',batch512k:'512K',batch1m:'1M',batchHint:labels[2]});}
copy['zh-CN'].reviewAllHint=copy['zh-CN'].reviewAllHint.replace('需配置 API','需配置 API 或开启手动聊天审核');
copy['zh-TW'].reviewAllHint=copy['zh-TW'].reviewAllHint.replace('需設定 API','需設定 API 或開啟手動聊天審核');
copy.en.reviewAllHint=copy.en.reviewAllHint.replace('requires API configuration','requires API configuration or manual chat review');
copy.ja.reviewAllHint=copy.ja.reviewAllHint.replace('API設定と辞書が必要','API設定または手動チャット審査と辞書が必要');
copy.ko.reviewAllHint=copy.ko.reviewAllHint.replace('API 설정과 사전이 필요','API 설정 또는 수동 채팅 검토와 사전이 필요');
const nameCopy={
 'zh-CN':['姓名整段保护（默认开启）','根据词典和分词结果保护完整姓名；同一拼写有人名和普通词义，或普通词有明显姓氏/分词/助词证据时，跳过本地转换交给 API 或手动模型审核。无模型时保留韩文。下次标注生效。'],
 'zh-TW':['姓名整段保護（預設開啟）','依詞典與斷詞保護完整姓名；相同拼寫有人名與一般詞義，或一般詞有姓氏、斷詞和助詞證據時，跳過本機轉換交由模型審核。未啟用模型時保留韓文。'],
 en:['Protect complete names (on by default)','When the exact spelling has both person-name and ordinary senses, or an ordinary word has strong surname, tokenization and particle evidence, skip local conversion and request API/manual review. Keep Korean without review.'],
 ja:['姓名全体を保護（初期設定は有効）','人名と一般語が同表記の場合や、姓氏・分かち書き・助詞の証拠がある一般語は、ローカル変換せずモデル審査へ送ります。審査が無効なら韓国語を保持します。'],
 ko:['이름 전체 보호 (기본 켜짐)','같은 표기에 인명과 일반 어휘가 함께 있거나 성씨·형태소 분리·조사 증거가 충분하면 로컬 변환을 건너뛰고 모델 검토로 보냅니다. 모델이 없으면 원래 한글을 유지합니다.']
};
for(const [locale,labels] of Object.entries(nameCopy))Object.assign(copy[locale],{nameProtection:labels[0],nameProtectionHint:labels[1]});
const reviewPosCopy={
 'zh-CN':['送审候选词性过滤（默认开启）','送审前过滤不兼容词性；NNB 只保留依存名词或未知项。全部冲突则保留原候选，下次标注生效。'],
 'zh-TW':['送審候選詞性過濾（預設開啟）','送審前過濾不相容詞性；NNB 只保留依存名詞或未知項。全部衝突則保留原候選，下次標註生效。'],
 en:['Filter review candidates by POS (on by default)','Filter POS conflicts before API or manual review. NNB keeps only explicit dependent nouns or unknown POS. Restore all if none remain. Applies to new tasks.'],
 ja:['審査候補を品詞で絞る（初期設定は有効）','NNB は依存名詞か品詞不明の候補のみ保持します。すべて不一致なら元の候補を保持。API・手動共通、次の処理から適用。'],
 ko:['검토 후보 품사 필터 (기본 켜짐)','NNB는 의존 명사 또는 품사 미상 후보만 유지합니다. 모두 불일치하면 원래 후보를 유지합니다. API·수동 공통, 새 작업부터 적용됩니다.']
};
for(const [locale,labels] of Object.entries(reviewPosCopy))Object.assign(copy[locale],{reviewPosFilter:labels[0],reviewPosFilterHint:labels[1]});
const preloadCopy={"zh-CN": ["浏览器启动时预加载（默认开启）", "提前加载本地词典、分词器和搭配索引，减少首次等待；关闭后按需加载。"], "zh-TW": ["瀏覽器啟動時預載入（預設開啟）", "提前載入本機詞典、分詞器和搭配索引，減少首次等待；關閉後按需載入。"], "en": ["Preload at browser startup (on by default)", "Load the local dictionary, tokenizer and collocation index early to reduce the first wait. Turn off to load on demand."], "ja": ["ブラウザー起動時に事前読み込み（初期設定は有効）", "辞書・形態素解析器・共起索引を先に読み込み、初回の待ち時間を短縮します。無効時は必要になってから読み込みます。"], "ko": ["브라우저 시작 시 미리 로드 (기본 켜짐)", "로컬 사전, 형태소 분석기와 연어 색인을 미리 로드하여 첫 대기를 줄입니다. 끄면 필요할 때 로드합니다."]};
for(const [locale,labels] of Object.entries(preloadCopy))Object.assign(copy[locale],{preloadEngineOnStartup:labels[0],preloadEngineHint:labels[1]});
const t=key=>(copy[$('uiLocale').value]||copy.en)[key];
function translate(){for(const el of document.querySelectorAll('[data-engine-i18n]'))el.textContent=t(el.dataset.engineI18n);}
async function save(changed){
 if(['reviewAllCandidates','manualModelReview'].includes(changed)&&$(changed).checked)$('enableModelReview').checked=true;
 if(changed==='enableModelReview'&&!$('enableModelReview').checked){$('reviewAllCandidates').checked=false;$('manualModelReview').checked=false;}
 await chrome.storage.local.set({preloadEngineOnStartup:$('preloadEngineOnStartup').checked,reviewPosFilter:$('reviewPosFilter').checked,nameProtection:$('nameProtection').checked,enableModelReview:$('enableModelReview').checked,reviewAllCandidates:$('reviewAllCandidates').checked,manualModelReview:$('manualModelReview').checked,batchContextTier:normalizeBatchContextTier($('batchContextTier').value)});status.textContent=t('saved');
}
const dictionaryLabels={en:['Dictionary imported','Dictionary not imported'],'zh-CN':['词典已导入','词典未导入，请选择 ZIP 或 DB 文件。'],'zh-TW':['詞典已匯入','詞典未匯入，請選擇 ZIP 或 DB 檔案。'],ja:['辞書を取り込み済み','辞書は未取り込みです。JSON ZIP を選択してください。'],ko:['사전 가져오기 완료','사전이 없습니다. JSON ZIP을 가져오세요.']};
let importedDictionary=false;
function show(result){importedDictionary=result.imported;status.textContent=(dictionaryLabels[$('uiLocale').value]||dictionaryLabels.en)[importedDictionary?0:1];}
async function refreshDictionaryStatus(){show(await readDictionaryInfo());}
function busy(value){$('dictionaryProgress').hidden=!value;for(const id of ['importDictionary','clearDictionary','dictionaryFile'])$(id).disabled=value;}
for(const key of ['enableModelReview','reviewAllCandidates','manualModelReview','batchContextTier','nameProtection','reviewPosFilter','preloadEngineOnStartup'])$(key).addEventListener('change',()=>save(key).catch(e=>status.textContent=e.message));
$('importDictionary').addEventListener('click',async()=>{const file=$('dictionaryFile').files?.[0];if(!file){status.textContent=t('missing');return;}busy(true);status.textContent=t('busy');try{await importBrowserDictionary(file);await refreshDictionaryStatus();chrome.runtime.sendMessage({type:'KRA_PRELOAD_ENGINE'}).catch(()=>{});}catch(e){status.textContent=e.message;}finally{busy(false);}});
$('clearDictionary').addEventListener('click',async()=>{busy(true);try{await clearBrowserDictionary();await refreshDictionaryStatus();}catch(e){status.textContent=e.message;}finally{busy(false);}});
$('uiLocale').addEventListener('change',()=>{translate();show({imported:importedDictionary});});
chrome.storage.local.get(['enableModelReview','reviewAllCandidates','manualModelReview','batchContextTier','nameProtection','reviewPosFilter','preloadEngineOnStartup','uiSettings']).then(async s=>{$('preloadEngineOnStartup').checked=s.preloadEngineOnStartup!==false;$('reviewPosFilter').checked=s.reviewPosFilter!==false;$('nameProtection').checked=s.nameProtection!==false;$('reviewAllCandidates').checked=s.reviewAllCandidates===true;$('manualModelReview').checked=s.manualModelReview===true;$('batchContextTier').value=normalizeBatchContextTier(s.batchContextTier);$('enableModelReview').checked=s.enableModelReview===true||s.reviewAllCandidates===true||s.manualModelReview===true;if(s.enableModelReview===undefined)await chrome.storage.local.set({preloadEngineOnStartup:$('preloadEngineOnStartup').checked,reviewPosFilter:$('reviewPosFilter').checked,nameProtection:$('nameProtection').checked,enableModelReview:$('enableModelReview').checked});if(s.uiSettings?.uiLocale)$('uiLocale').value=s.uiSettings.uiLocale;translate();await refreshDictionaryStatus();}).catch(e=>status.textContent=e.message);translate();
