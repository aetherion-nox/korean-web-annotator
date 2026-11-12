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
 'zh-CN':['全部交给大模型审核（默认关闭）','开启后，本地只查词和定位，所有可标注的汉字词、外来语和混种词候选均由模型选义，也可保留韩文。自动启用模型审核，需配置 API；未返回有效结果的词保留韩文。词典已导入时继续使用词典候选；未导入词典时必须打开实验性词源补全，此时由 Kiwi 提取待审核词。请求量、费用和等待时间可能增加；下一次标注生效。'],
 'zh-TW':['全部交給大模型審核（預設關閉）','開啟後，本機只查詞和定位，所有可標註的漢字詞、外來語和混種詞候選均由模型選義，也可保留韓文。自動啟用模型審核，需設定 API；無有效結果時保留韓文。已匯入詞典時使用原有詞典候選；無詞典時需啟用實驗性詞源補全，由 Kiwi 擷取候選詞。請求量、費用及等待時間可能增加；下次標註生效。'],
 en:['Review all candidates with the model (off by default)','Local processing only looks up and locates words; the model decides every eligible Hanja, loanword and mixed-origin candidate, including KEEP. Automatically enables model review and requires API configuration. Missing or invalid answers leave Korean unchanged. Imported dictionaries use the original candidate workflow; without one, experimental origin completion is required and Kiwi supplies the targets. Requests, cost and waiting time may increase. Applies to new tasks.'],
 ja:['すべての候補をモデルで審査（初期設定は無効）','ローカル処理は辞書検索と位置特定のみ行い、漢字語・外来語・混種語の全候補をモデルが判断します。韓国語のまま保持する選択も可能です。モデル審査を自動で有効化し、API設定が必要です。辞書がない場合、実験的な語源補完機能を有効にする必要があります。無効な回答や未収録語は韓国語のまま保持します。通信量・費用・待ち時間が増える場合があります。次の処理から適用。'],
 ko:['모든 후보를 모델로 검토 (기본 꺼짐)','로컬에서는 사전 검색과 위치 확인만 하며, 모든 한자어·외래어·혼종어 후보의 뜻을 모델이 선택하거나 한글로 유지합니다. 모델 검토가 자동 활성화되며 API 설정이 필요합니다. 사전이 없으면 실험적 어원 보완을 켜야 합니다. 유효한 답이 없거나 사전에 없는 단어는 한글로 유지합니다. 요청량·비용·대기 시간이 늘어날 수 있습니다. 새 작업부터 적용됩니다.']
};
for(const [locale,labels] of Object.entries(reviewCopy)){copy[locale].reviewAll=labels[0];copy[locale].reviewAllHint=labels[1];}
const manualCopy={
 'zh-CN':['手动聊天审核（复制提示词／粘贴结果）','默认关闭。开启后自动启用审核，并用网页上的手动面板代替 API：复制或下载提示词给聊天模型，再把完整 JSON 结果粘贴回来。不需要 API Key；未导入词典时需要打开实验性汉字词或外来语 LLM 补充选项。可与“全部交给大模型审核”一起使用，否则仅处理待消歧候选。较多内容会分批，等待回填不限 API 超时时间；刷新或离开网页会取消任务。下一次标注生效。'],
 'zh-TW':['手動聊天審核（複製提示詞／貼上結果）','預設關閉。開啟後自動啟用審核，以網頁手動面板代替 API：複製或下載提示詞給聊天模型，再貼回完整 JSON。無需 API Key；若未匯入詞典，必須啟用實驗性漢字詞或外來語 LLM 補全。可搭配全部審核，否則只處理歧義候選。內容較多時分批；等候回填無 API 逾時限制，重新整理或離開頁面會取消。下次標註生效。'],
 en:['Manual chat review (copy prompt / paste result)','Off by default. Enables review and replaces API calls with an on-page panel: copy or download the prompt for a chat model, then paste its complete JSON answer. No API key is needed; without an imported dictionary, enable experimental Hanja or loanword origins. Combine with Review all candidates to review locally certain words too. Larger tasks are split into batches. Waiting has no API timeout; reloading or leaving the page cancels the task. Applies to new tasks.'],
 ja:['手動チャット審査（プロンプトをコピー／結果を貼り付け）','初期設定は無効。審査を自動で有効化し、APIの代わりにページのパネルでプロンプトをコピー・保存してチャットモデルへ送り、完全なJSON結果を貼り付けます。APIキーは不要です。辞書がない場合は、実験的な漢字または外来語の補完機能を有効にしてください。全候補審査との併用も可能。多い場合は分割し、入力待ちにAPIのタイムアウトはありません。ページを離れるか再読み込みすると中止します。次の処理から適用。'],
 ko:['수동 채팅 검토 (프롬프트 복사 / 결과 붙여넣기)','기본 꺼짐. 검토를 자동 활성화하고 API 대신 페이지 패널에서 프롬프트를 복사·다운로드해 채팅 모델에 전달한 뒤 전체 JSON 결과를 붙여넣습니다. API 키는 필요 없습니다. 사전이 없다면 실험적 한자어 또는 외래어 보완 기능을 켜세요. 모든 후보 검토와 함께 쓸 수 있습니다. 큰 작업은 나누며 입력 대기에 API 시간 제한은 없습니다. 페이지를 떠나거나 새로고침하면 취소됩니다. 새 작업부터 적용됩니다.']
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
const outputTokenCopy={
 'zh-CN':['API 每批最大输出 tokens（默认 16384）','手动聊天每批最大输出 tokens（默认 65536）','允许 1024～1,000,000。API 数值会作为 max_tokens／max_completion_tokens／max_output_tokens 发送；手动模式仅决定如何分批，不控制聊天模型的实际回复上限。数值必须处于模型服务商支持的范围，过高可能报错。下一次标注生效。','输出上限必须是 1024～1,000,000 之间的整数。'],
 'zh-TW':['API 每批最大輸出 tokens（預設 16384）','手動聊天每批最大輸出 tokens（預設 65536）','允許 1024～1,000,000。API 數值作為輸出 token 限制發送；手動模式只控制分批，不控制聊天模型實際回覆上限。請依服務商實際支援的範圍設定，過高可能報錯。下次任務生效。','輸出上限須為 1024～1,000,000 的整數。'],
 en:['Max API output tokens per batch (default 16384)','Max manual-chat output tokens per batch (default 65536)','Integers 1,024–1,000,000. The API value is sent as max_tokens, max_completion_tokens or max_output_tokens; manual mode only controls batching, not the chat model’s actual reply limit. The provider may reject unsupported values. Applies to the next run.','Output limits must be integers between 1,024 and 1,000,000.'],
 ja:['API 1バッチの最大出力トークン（既定 16384）','手動チャットの最大出力トークン（既定 65536）','1,024～1,000,000 の整数。API には出力制限を送信します。手動チャットでは分割計画のみに使用し、チャット側の実際の制限は変更しません。モデルが非対応なら失敗する場合があります。次回から適用。','出力上限は 1,024～1,000,000 の整数を指定してください。'],
 ko:['API 배치당 최대 출력 토큰 (기본 16384)','수동 채팅 배치당 최대 출력 토큰 (기본 65536)','1,024~1,000,000 사이의 정수. API 제한은 모델로 전송되며 수동 모드에서는 배치 계획만 변경합니다. 채팅 모델의 실제 출력 한도는 바꾸지 못합니다. 모델이 지원하지 않는 값은 오류가 날 수 있습니다. 다음 작업부터 적용.','출력 한도는 1,024~1,000,000 사이의 정수여야 합니다.']
};
for(const [locale,labels] of Object.entries(outputTokenCopy))
 Object.assign(copy[locale],{apiOutputTokenLimitLabel:labels[0],manualOutputTokenLimitLabel:labels[1],outputTokenLimitHint:labels[2],outputTokenLimitError:labels[3]});
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
const personFilterCopy={
 'zh-CN':['过滤词典内的人名（默认开启）','过滤词典明确标为“人名”的义项；分类缺失时，仅对释义开头同时具有具体人物身份与生卒年代的明确传记词条进行保守过滤。同形普通词义照常保留，DB 不被修改、无需重新导入。与“姓名整段保护”独立。'],
 'zh-TW':['過濾詞典內的人名（預設開啟）','排除詞典明確標為人名的義項；若類別缺漏，僅在釋義開頭同時含有具體人物身分和生卒年代時保守辨識。保留同形普通詞義，不修改或重新匯入 DB；與姓名整段保護分開設定。'],
 en:['Filter dictionary person names (on by default)','Exclude explicitly categorized personal-name senses; if category metadata is missing, also exclude clear biographical glosses combining a person role and lifespan. Ordinary homographs remain. Does not modify or reimport the DB; separate from complete-name protection.'],
 ja:['辞書内の人名を除外（初期設定は有効）','人名として分類された語義を除外します。分類が欠ける場合は、人物の肩書と生没年を備えた明確な伝記語義のみ慎重に除外します。同形の普通語義は残り、DB の変更や再取込は不要です。'],
 ko:['사전 내 인명 후보 제외 (기본 켜짐)','인명으로 분류된 뜻풀이를 제외합니다. 분류가 없을 때는 인물의 역할과 생몰년이 함께 나타나는 명백한 전기 뜻풀이만 보수적으로 제외합니다. 동형 일반어 뜻은 유지하고 DB를 수정하거나 다시 가져오지 않습니다.']
};
for(const [locale,labels] of Object.entries(personFilterCopy))Object.assign(copy[locale],{filterDictionaryPeople:labels[0],filterDictionaryPeopleHint:labels[1]});
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

const experimentalCopy={
 'zh-CN':{
  experimentalHanja:'实验性：直接补全汉字词源（默认关闭）',
  experimentalHanjaHint:'同一轮模型审核中，若原词典没有合适义项且词源可靠，可直接在 results 的 choice_id 写入汉字，不再使用 experimental_options 或 x0，也无需先选 KEEP。本地验证音节对齐、词界与姓名保护。',
  experimentalLoanword:'实验性：直接补全外来语原词（默认关闭）',
  experimentalLoanwordHint:'同一轮审核中可在 choice_id 直接填写真实借词原文的拉丁字拼写，而不是翻译。现有 c0/n0/KEEP 仍可选；本地严格校验词界与字符。不生成额外候选数组。'
 },
 'zh-TW':{
  experimentalHanja:'實驗性：直接補全漢字詞源（預設關閉）',
  experimentalHanjaHint:'同輪審核時，若原字典沒有合適義項且詞源可靠，可在 results.choice_id 直接寫漢字。不使用 experimental_options 或 x0，也不需要先選 KEEP；本地驗證對齊、詞界與姓名保護。',
  experimentalLoanword:'實驗性：直接補全外來語原文（預設關閉）',
  experimentalLoanwordHint:'同輪審核可在 choice_id 直接填入真正的借詞拉丁字拼寫，不做英文翻譯。原 c0/n0/KEEP 仍可使用，本機檢查格式與詞界。'
 },
 en:{
  experimentalHanja:'Experimental: literal Hanja origins (off by default)',
  experimentalHanjaHint:'In one model response, if no dictionary sense fits and the true origin is known, write Hanja directly in results.choice_id. No experimental_options, x0 or preliminary KEEP step. Local alignment, name and boundary checks still apply.',
  experimentalLoanword:'Experimental: literal loanword originals (off by default)',
  experimentalLoanwordHint:'Write the actual borrowed Latin-script original directly in choice_id when no supplied sense fits, never an English translation. Existing c0/n0/KEEP selections still work; all origins are checked locally.'
 },
 ja:{
  experimentalHanja:'実験：漢字語源を直接指定（初期設定は無効）',
  experimentalHanjaHint:'辞書の候補が適切でなく語源に確証がある場合、同じ results.choice_id に漢字を直接記入します。別の候補配列や KEEP 後の再審査は不要です。アライメント・人名を検証します。',
  experimentalLoanword:'実験：外来語の原綴りを直接指定（初期設定は無効）',
  experimentalLoanwordHint:'真の借用元のラテン文字表記を choice_id に直接記入します。英訳ではありません。既存の選択肢は引き続き使用できます。'
 },
 ko:{
  experimentalHanja:'실험: 한자 어원 직접 선택 (기본 꺼짐)',
  experimentalHanjaHint:'사전 후보가 맞지 않고 실제 어원을 확실히 알 때 같은 results.choice_id에 한자를 직접 작성합니다. 별도 배열이나 KEEP 후 재검토가 필요하지 않습니다. 정렬·인명·경계를 확인합니다.',
  experimentalLoanword:'실험: 외래어 원어 직접 선택 (기본 꺼짐)',
  experimentalLoanwordHint:'실제 차용어의 라틴 문자 원어를 choice_id에 직접 작성합니다. 영문 번역을 대신 쓰지 않습니다. 기존 사전 선택지도 그대로 사용합니다.'
 }
};
for(const [locale,labels] of Object.entries(experimentalCopy))Object.assign(copy[locale],labels);
const segmentationCopy={
 'zh-CN':['实验性：LLM 智能分词修复（默认关闭）','开启后，完整韩语句子、Kiwi 分词线索和已由本地确定的词也会提交至你选择的模型服务，可能明显增加费用。模型在同一轮审核中检查错分与漏词；仅通过本地校验的修复会生效。模型自行提供的未核实词源会用虚线标记。'],
 'zh-TW':['實驗性：LLM 智慧斷詞修復（預設關閉）','開啟時會把完整韓語句子、Kiwi 斷詞線索及本地已確定的詞送交指定模型，可能增加費用。一次請求同時校正斷詞與漏詞，修復須通過本地驗證；模型自寫的未核實詞源會有虛線標記。'],
 en:['Experimental: LLM segmentation repair (off by default)','When enabled, complete Korean sentences, Kiwi token hints and locally decided words are also sent to your chosen model provider, potentially increasing costs. The same request checks incorrect boundaries and missing words; only locally validated repairs apply. Unverified model-origin spellings are visibly marked.'],
 ja:['実験：LLM による分かち書き修正（初期設定は無効）','有効にすると、韓国語の全文、Kiwi の解析情報、ローカルで確定した語も指定先モデルに送信され、費用が増える場合があります。同じリクエストで語境界や漏れを確認し、検証済みの修正のみ適用します。未確認のモデル語源は区別して表示します。'],
 ko:['실험: LLM 지능형 형태소 경계 수정 (기본 꺼짐)','활성화하면 한국어 원문 전체, Kiwi 형태소 정보 및 로컬에서 결정된 단어도 선택한 모델 제공업체에 전송되므로 비용이 늘 수 있습니다. 한 번의 요청으로 분절·누락을 검사하고 검증된 수정만 적용합니다. 모델이 생성한 미확인 어원은 따로 표시합니다.']
};
for(const [locale,labels] of Object.entries(segmentationCopy))Object.assign(copy[locale],{smartSegmentation:labels[0],smartSegmentationHint:labels[1]});
const localAuditCopy={
 'zh-CN':['本地已确定标注也交给模型复核（默认开启）','启用模型审核时，本地确定不标注的词原样保留；本地确定要转成汉字或外来语的词不直接应用，而是使用原有词界与词典候选交给模型选义。无有效模型答案则保留韩文。关闭模型审核时仍按原本地规则运行。'],
 'zh-TW':['本機已確定的標註也交由模型複核（預設開啟）','啟用模型審核時，本機確定不標註的詞保持原樣；本機決定轉換的詞不直接套用，改以原詞界和詞典候選交模型確認。模型無有效結果則保留韓文。模型審核關閉時仍使用原本機流程。'],
 en:['Review locally confirmed conversions with the model (on by default)','When model review is enabled, local KEEP/nonconversion results stay unchanged. Locally confirmed Hanja/loanword conversions are withheld and sent with their dictionary options to the model. Invalid or unavailable answers keep Korean. Without model review, normal local behavior remains.'],
 ja:['ローカルで確定した変換もモデルで確認（初期設定は有効）','モデル審査が有効なら、非変換と判断した語は保持し、確定した漢字語・外来語の変換を直接適用せず既存の辞書候補で再審査します。無効な結果は韓国語を保持。モデル審査無効時は従来のローカル処理を維持します。'],
 ko:['로컬 확정 변환도 모델로 재검토 (기본 켜짐)','모델 검토 시 로컬의 비변환 결정은 그대로 두고, 한자어/외래어로 확정된 변환은 바로 적용하지 않고 기존 사전 후보로 재검토합니다. 응답이 무효이거나 없으면 한글을 유지합니다. 모델 검토를 끄면 기존 로컬 동작이 유지됩니다.']
};
for(const [locale,labels] of Object.entries(localAuditCopy))Object.assign(copy[locale],{reviewLocalConversions:labels[0],reviewLocalConversionsHint:labels[1]});
const readingCopy={
 'zh-CN':['汉字词源读音校验（默认开启）','对模型直接填写的汉字进行多读音与词首音变校验。关闭仅跳过读音比对；字形、词界、位置、人名保护仍然执行。不能证明词源正确。'],
 'zh-TW':['漢字詞源讀音驗證（預設開啟）','檢查模型直接填寫漢字的多讀音與詞首音變。關閉只跳過讀音比對；字形、詞界、位置及姓名保護維持不變。不能證明語源正確。'],
 en:['Verify model Hanja readings (on by default)','Checks known multiple Sino-Korean readings and initial-sound alternations. Turning it off skips only reading comparison; script, position, boundary and name checks remain. Does not prove etymology.'],
 ja:['モデル漢字語源の読みを照合（既定でオン）','複数の音読みと頭音法則を確認します。オフにしても字形・境界・位置・人名保護は有効です。正しい語源の保証ではありません。'],
 ko:['모델 한자 어원 독음 검사 (기본 켜짐)','복수 한자 독음과 두음법칙을 검사합니다. 꺼도 문자·위치·어절 경계·인명 보호는 유지됩니다. 어원의 진위를 보장하지 않습니다.']
};
for(const [locale,labels] of Object.entries(readingCopy))Object.assign(copy[locale],{hanjaReadingCheck:labels[0],hanjaReadingCheckHint:labels[1]});
const t=key=>(copy[$('uiLocale').value]||copy.en)[key];
function translate(){for(const el of document.querySelectorAll('[data-engine-i18n]'))el.textContent=t(el.dataset.engineI18n);}
async function save(changed){
 const apiLimit=Number($('apiOutputTokenLimit').value),manualLimit=Number($('manualOutputTokenLimit').value);
 if(!Number.isSafeInteger(apiLimit)||apiLimit<1024||apiLimit>1000000||
    !Number.isSafeInteger(manualLimit)||manualLimit<1024||manualLimit>1000000){
  status.textContent=t('outputTokenLimitError');return;
 }
 if(['reviewAllCandidates','manualModelReview','experimentalHanja','experimentalLoanword','smartSegmentation'].includes(changed)&&$(changed).checked)$('enableModelReview').checked=true;
 if(changed==='enableModelReview'&&!$('enableModelReview').checked){$('reviewAllCandidates').checked=false;$('manualModelReview').checked=false;$('experimentalHanja').checked=false;$('experimentalLoanword').checked=false;$('smartSegmentation').checked=false;}
 await chrome.storage.local.set({preloadEngineOnStartup:$('preloadEngineOnStartup').checked,reviewPosFilter:$('reviewPosFilter').checked,nameProtection:$('nameProtection').checked,filterDictionaryPeople:$('filterDictionaryPeople').checked,enableModelReview:$('enableModelReview').checked,reviewAllCandidates:$('reviewAllCandidates').checked,manualModelReview:$('manualModelReview').checked,reviewLocalConversions:$('reviewLocalConversions').checked,experimentalHanja:$('experimentalHanja').checked,experimentalLoanword:$('experimentalLoanword').checked,hanjaReadingCheck:$('hanjaReadingCheck').checked,smartSegmentation:$('smartSegmentation').checked,batchContextTier:normalizeBatchContextTier($('batchContextTier').value),apiOutputTokenLimit:apiLimit,manualOutputTokenLimit:manualLimit});show({imported:importedDictionary});status.textContent=t('saved')+'\n'+status.textContent;
}
const dictionaryLabels={en:['Dictionary imported','Dictionary not imported'],'zh-CN':['词典已导入','词典未导入，请选择 ZIP 或 DB 文件。'],'zh-TW':['詞典已匯入','詞典未匯入，請選擇 ZIP 或 DB 檔案。'],ja:['辞書を取り込み済み','辞書は未取り込みです。JSON ZIP を選択してください。'],ko:['사전 가져오기 완료','사전이 없습니다. JSON ZIP을 가져오세요.']};
const dictionaryFreeLabels={
 en:['No imported dictionary: Kiwi + experimental LLM origin completion is available. Native words and uncertain origins remain unannotated.','No dictionary imported. Import a dictionary, or enable model review plus experimental Hanja and/or loanword origin completion.'],
 'zh-CN':['未导入词典：可使用 Kiwi + 实验性 LLM 词源补全。固有词与不确定词保持原文。','未导入词典：请先导入词典，或者开启模型审核并至少开启一项实验性汉字词／外来语 LLM 补充选项。'],
 'zh-TW':['未匯入詞典：可使用 Kiwi + 實驗性 LLM 詞源補全，固有詞及不確定詞保留原文。','未匯入詞典：請先匯入詞典，或啟用模型審核及至少一項實驗性漢字詞／外來語補全。'],
 ja:['辞書なし：Kiwi + 実験的LLM語源補完が使用可能。確証のない語は保持します。','辞書なし：辞書を読み込むか、モデル審査と実験的漢字／外来語の語源補完を有効にしてください。'],
 ko:['사전 없음: Kiwi + 실험적 LLM 어원 보완을 사용할 수 있습니다. 불확실한 단어는 유지합니다.','사전 없음: 사전을 가져오거나 모델 검토와 실험적 한자어/외래어 보완을 켜세요.']
};
let importedDictionary=false;
function show(result){importedDictionary=result.imported;const locale=$('uiLocale').value;if(importedDictionary){status.textContent=(dictionaryLabels[locale]||dictionaryLabels.en)[0];return;}const allowed=$('enableModelReview').checked&&($('experimentalHanja').checked||$('experimentalLoanword').checked);status.textContent=(dictionaryFreeLabels[locale]||dictionaryFreeLabels.en)[allowed?0:1];}
async function refreshDictionaryStatus(){show(await readDictionaryInfo());}
function busy(value){$('dictionaryProgress').hidden=!value;for(const id of ['importDictionary','clearDictionary','dictionaryFile'])$(id).disabled=value;}
for(const key of ['enableModelReview','reviewAllCandidates','manualModelReview','experimentalHanja','experimentalLoanword','hanjaReadingCheck','smartSegmentation','reviewLocalConversions','batchContextTier','apiOutputTokenLimit','manualOutputTokenLimit','nameProtection','filterDictionaryPeople','reviewPosFilter','preloadEngineOnStartup'])$(key).addEventListener('change',()=>save(key).catch(e=>status.textContent=e.message));
$('importDictionary').addEventListener('click',async()=>{const file=$('dictionaryFile').files?.[0];if(!file){status.textContent=t('missing');return;}busy(true);status.textContent=t('busy');try{await importBrowserDictionary(file);await refreshDictionaryStatus();chrome.runtime.sendMessage({type:'KRA_PRELOAD_ENGINE'}).catch(()=>{});}catch(e){status.textContent=e.message;}finally{busy(false);}});
$('clearDictionary').addEventListener('click',async()=>{busy(true);try{await clearBrowserDictionary();await refreshDictionaryStatus();}catch(e){status.textContent=e.message;}finally{busy(false);}});
$('uiLocale').addEventListener('change',()=>{translate();show({imported:importedDictionary});});
chrome.storage.local.get(['enableModelReview','reviewAllCandidates','manualModelReview','experimentalHanja','experimentalLoanword','hanjaReadingCheck','smartSegmentation','reviewLocalConversions','batchContextTier','apiOutputTokenLimit','manualOutputTokenLimit','nameProtection','filterDictionaryPeople','reviewPosFilter','preloadEngineOnStartup','uiSettings']).then(async s=>{$('preloadEngineOnStartup').checked=s.preloadEngineOnStartup!==false;$('reviewPosFilter').checked=s.reviewPosFilter!==false;$('nameProtection').checked=s.nameProtection!==false;$('filterDictionaryPeople').checked=s.filterDictionaryPeople!==false;$('reviewAllCandidates').checked=s.reviewAllCandidates===true;$('manualModelReview').checked=s.manualModelReview===true;$('reviewLocalConversions').checked=s.reviewLocalConversions!==false;$('experimentalHanja').checked=s.experimentalHanja===true;$('experimentalLoanword').checked=s.experimentalLoanword===true;$('hanjaReadingCheck').checked=s.hanjaReadingCheck!==false;$('smartSegmentation').checked=s.smartSegmentation===true;$('batchContextTier').value=normalizeBatchContextTier(s.batchContextTier);$('apiOutputTokenLimit').value=Number.isSafeInteger(s.apiOutputTokenLimit)&&s.apiOutputTokenLimit>=1024&&s.apiOutputTokenLimit<=1000000?s.apiOutputTokenLimit:16384;$('manualOutputTokenLimit').value=Number.isSafeInteger(s.manualOutputTokenLimit)&&s.manualOutputTokenLimit>=1024&&s.manualOutputTokenLimit<=1000000?s.manualOutputTokenLimit:65536;$('enableModelReview').checked=s.enableModelReview===true||s.reviewAllCandidates===true||s.manualModelReview===true||s.experimentalHanja===true||s.experimentalLoanword===true||s.smartSegmentation===true;if(s.enableModelReview===undefined)await chrome.storage.local.set({preloadEngineOnStartup:$('preloadEngineOnStartup').checked,reviewPosFilter:$('reviewPosFilter').checked,nameProtection:$('nameProtection').checked,enableModelReview:$('enableModelReview').checked});if(s.uiSettings?.uiLocale)$('uiLocale').value=s.uiSettings.uiLocale;translate();await refreshDictionaryStatus();}).catch(e=>status.textContent=e.message);translate();
