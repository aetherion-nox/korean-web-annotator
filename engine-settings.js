import {readDictionaryInfo,importBrowserDictionary,clearBrowserDictionary} from './browser-engine.js';
import {normalizeBatchContextTier} from './batch-budget.js';
import {ENGINE_SWITCH_DEFAULTS,engineSwitchValues} from './engine-defaults.js';
const copy={
 en:{title:'Browser dictionary engine',model:'Enable optional model review (on by default)',instructions:'The algorithm runs entirely inside this extension. No Python server, pairing token or startup script is required.',download:'Download official Korean dictionary JSON ZIP',import:'Import the official JSON ZIP without extracting, or a hanja_dict.db built on your computer to skip ZIP parsing and database construction.',file:'Dictionary ZIP or database',importButton:'Import dictionary',clear:'Remove dictionary',save:'Save settings',saved:'Settings saved.',ready:'Ready',missing:'Select a dictionary file above, then click Import dictionary.',busy:'Importing dictionary… Keep this settings page open.',removed:'Dictionary removed.'},
 'zh-CN':{title:'浏览器内词典引擎',model:'启用可选模型审核（默认开启）',instructions:'算法全部在插件内运行，无需 Python 服务器、配对令牌或启动脚本。',download:'下载官方韩语词典 JSON ZIP',import:'可直接导入官方 JSON ZIP；手机也可选择电脑预处理生成的 hanja_dict.db，省去解压、解析和建库。不同词典快照的结果可能不同。',file:'词典文件（ZIP 或数据库）',importButton:'导入词典',clear:'移除词典',save:'保存设置',saved:'设置已保存。',ready:'就绪',missing:'请先选择上方的词典文件，再点击“导入词典”。',busy:'正在导入词典… 请保持设置页面打开。',removed:'词典已移除。'},
 'zh-TW':{title:'瀏覽器內詞典引擎',model:'啟用可選模型審核（預設開啟）',instructions:'演算法全部在擴充功能內執行，無需 Python 伺服器、配對權杖或啟動腳本。',download:'下載官方韓語詞典 JSON ZIP',import:'可匯入官方 JSON ZIP，或電腦預處理產生的 hanja_dict.db，省去解壓縮、解析及建庫。不同詞典快照的結果可能不同。',file:'詞典檔案（ZIP 或資料庫）',importButton:'匯入詞典',clear:'移除詞典',save:'儲存設定',saved:'設定已儲存。',ready:'就緒',missing:'請先選擇上方的詞典檔案，再點擊「匯入詞典」。',busy:'正在匯入詞典… 請保持設定頁面開啟。',removed:'詞典已移除。'},
 ja:{title:'ブラウザー内辞書エンジン',model:'任意のモデル審査を有効化（初期設定は有効）',instructions:'アルゴリズムは拡張機能内で動作します。Python サーバーや起動スクリプトは不要です。',download:'公式韓国語辞書 JSON ZIP をダウンロード',import:'公式 JSON ZIP、またはパソコンで作成した hanja_dict.db を取り込めます。データベース形式では ZIP の解析と構築を省略します。',file:'辞書 ZIP またはデータベース',importButton:'辞書を取り込む',clear:'辞書を削除',save:'設定を保存',saved:'設定を保存しました。',ready:'準備完了',missing:'先に上の辞書ファイルを選択してから、取り込みを押してください。',busy:'辞書を取り込み中… このページを開いたままにしてください。',removed:'辞書を削除しました。'},
 ko:{title:'브라우저 사전 엔진',model:'선택적 모델 검토 사용 (기본 켜짐)',instructions:'알고리즘이 확장 프로그램 안에서 실행됩니다. Python 서버나 시작 스크립트가 필요하지 않습니다.',download:'공식 한국어 사전 JSON ZIP 다운로드',import:'공식 JSON ZIP 또는 컴퓨터에서 만든 hanja_dict.db를 가져올 수 있습니다. DB 형식은 ZIP 분석과 사전 구축을 생략합니다.',file:'사전 ZIP 또는 데이터베이스',importButton:'사전 가져오기',clear:'사전 삭제',save:'설정 저장',saved:'설정이 저장되었습니다.',ready:'준비됨',missing:'위에서 사전 파일을 선택한 다음 가져오기를 누르세요。',busy:'사전 가져오는 중… 이 페이지를 닫지 마세요.',removed:'사전이 삭제되었습니다.'}
};
const $=id=>document.getElementById(id),status=$('engineStatus');
const reviewCopy={
 'zh-CN':['全部交给大模型审核（默认关闭）','开启后，本地只查词和定位，所有可标注的汉字词、外来语和混种词候选均由模型选义，也可保留韩文。自动启用模型审核，需配置 API；未返回有效结果的词保留韩文。词典已导入时继续使用词典候选；未导入词典时必须打开实验性词源补全，此时由 Kiwi 提取待审核词。请求量、费用和等待时间可能增加；下一次标注生效。'],
 'zh-TW':['全部交給大模型審核（預設關閉）','開啟後，本機只查詞和定位，所有可標註的漢字詞、外來語和混種詞候選均由模型選義，也可保留韓文。自動啟用模型審核，需設定 API；無有效結果時保留韓文。已匯入詞典時使用原有詞典候選；無詞典時需啟用實驗性詞源補全，由 Kiwi 擷取候選詞。請求量、費用及等待時間可能增加；下次標註生效。'],
 en:['Review all candidates with the model (off by default)','Local processing only looks up and locates words; the model decides every eligible Hanja, loanword and mixed-origin candidate, including KEEP. Automatically enables model review and requires API configuration. Missing or invalid answers leave Korean unchanged. Imported dictionaries use the original candidate workflow; without one, experimental origin completion is required and Kiwi supplies the targets. Requests, cost and waiting time may increase. Applies to new tasks.'],
 ja:['すべての候補をモデルで審査（初期設定は無効）','ローカル処理は辞書検索と位置特定のみ行い、漢字語・外来語・混種語の全候補をモデルが判断します。韓国語のまま保持する選択も可能です。モデル審査を自動で有効化し、API設定が必要です。辞書がない場合、実験的な語源補完機能を有効にする必要があります。無効な回答や未収録語は韓国語のまま保持します。通信量・費用・待ち時間が増える場合があります。次の処理から適用。'],
 ko:['모든 후보를 모델로 검토 (기본 꺼짐)','로컬에서는 사전 검색과 위치 확인만 하며, 모든 한자어·외래어·혼종어 후보의 뜻을 모델이 선택하거나 한글로 유지합니다. 모델 검토가 자동 활성화되며 API 설정이 필요합니다. 사전이 없으면 실험적 어원 보완을 켜야 합니다. 유효한 답이 없거나 사전에 없는 단어는 한글로 유지합니다. 요청량·비용·대기 시간이 늘어날 수 있습니다. 새 작업부터 적용됩니다.']
};
const retryChoiceCopy={
 'zh-CN':['有效答案立即应用，错误词典编号单独补交（默认开启）','只接受真实 JSON null、大小写不敏感的字符串 "null"、当前目标有效的 c/n 编号，以及经安全校验的实验性汉字/拉丁词源。模型返回其他无效选项、错误 p 编号或不合法自由词源时，保留已验证答案，只补交错误目标；手动显示纠错提示词，API 自动重试。与直接丢弃模式互斥，必须二选一。'],
 'zh-TW':['有效答案立即套用，錯誤詞典編號單獨補交（預設開啟）','保留已驗證的選項；不存在的 c/n 編號會生成只包含錯誤目標及原候選的新請求。手動顯示補交提示，API 自動重試；實驗性自填詞源不參與。'],
 en:['Apply valid answers; retry invalid dictionary IDs (on by default)','Commit validated choices immediately. Retry only invalid c/n dictionary IDs with the original options, without resending completed answers. Manual shows a correction prompt; API retries automatically. Experimental free-form origins are excluded.'],
 ja:['有効な回答を即時適用・誤った辞書番号のみ再照会（既定でオン）','検証済みの回答を保持して適用し、存在しない c/n 辞書番号のみ元の候補を使って再照会します。手動では補正プロンプトを表示、API では自動再試行します。実験的な自由入力の語源は対象外です。'],
 ko:['유효 답변 즉시 적용·잘못된 사전 번호만 재요청(기본 켜짐)','검증된 답변은 바로 적용하고 존재하지 않는 c/n 사전 번호만 원래 후보로 재요청합니다. 수동 모드는 수정 프롬프트를 표시하고 API는 자동 재시도합니다. 실험적 자유 어원은 제외합니다.']
};
for(const [locale,labels] of Object.entries(retryChoiceCopy))Object.assign(copy[locale],{retryInvalidDictionaryChoices:labels[0],retryInvalidDictionaryChoicesHint:labels[1]});
const discardChoiceCopy={
 'zh-CN':['直接丢弃非法结果，不重试（默认关闭）','保留本批已验证的答案，所有非法选项、错误 p 编号、无法验证的开放词源、冲突重复、遗漏或空白回答均按 JSON null 保留韩文，不再请求模型补交。合法的 JSON null 与字符串 "null"/"NULL" 同样保留韩文。仅影响答案校验；网络故障仍按原重试策略。与“错误词典编号单独补交”必须二选一。'],
 'zh-TW':['直接捨棄無效結果，不再重試（預設關閉）','套用本批合法答案；無效選項、多條格式合法的重複答案、遺漏目標及缺少或空白的 c 均視為 JSON null，保留韓文；完全相同的格式合法 t/c 答案合併為一條；不同 c 的多條合法答案仍全部作廢。字串 "null"/"NULL" 仍保留韓文。網路故障仍依原有策略重試。與詞典編號補交互斥。'],
 en:['Discard invalid results without retrying (off by default)','Apply valid answers, keep one structurally valid answer despite malformed duplicates, and collapse exactly identical t/c copies; treat invalid choices, multiple well-formed duplicates, omitted targets and absent/blank c as JSON null (keep Korean), without correction requests. The strings "null"/"NULL" still mean keep Korean. Network failures retain their normal retry policy. Mutually exclusive with dictionary-choice retry.'],
 ja:['無効な結果を破棄し再試行しない（初期設定はオフ）','有効な回答だけ適用し、無効な選択、重複、欠落した回答や空の c はすべて JSON null として韓国語を保持します。"null"/"NULL" は韓国語のまま保持します。通信エラーの再試行は従来どおり。辞書番号の再照会と排他です。'],
 ko:['잘못된 결과 폐기, 재요청 안 함 (기본 꺼짐)','유효한 답변만 적용하고 잘못된 선택, 중복, 누락된 답변 및 빈 c는 모두 JSON null로 처리해 한국어를 유지합니다. "null"/"NULL" 문자열은 한국어를 유지합니다. 네트워크 오류는 기존 재시도 규칙을 따릅니다. 사전 번호 재요청과 상호 배타적입니다.']
};
for(const [locale,labels] of Object.entries(discardChoiceCopy))Object.assign(copy[locale],{discardInvalidReviewResults:labels[0],discardInvalidReviewResultsHint:labels[1]});

for(const [locale,labels] of Object.entries(reviewCopy)){copy[locale].reviewAll=labels[0];copy[locale].reviewAllHint=labels[1];}
const manualCopy={
 'zh-CN':['手动聊天审核（复制提示词／粘贴结果）','默认开启。开启后自动启用审核，并用网页上的手动面板代替 API：复制或下载提示词给聊天模型，再把完整 JSON 结果粘贴回来。不需要 API Key；未导入词典时需要打开实验性汉字词或外来语 LLM 补充选项。可与“全部交给大模型审核”一起使用，否则仅处理待消歧候选。较多内容会分批，等待回填不限 API 超时时间；刷新或离开网页会取消任务。下一次标注生效。'],
 'zh-TW':['手動聊天審核（複製提示詞／貼上結果）','預設開啟。開啟後自動啟用審核，以網頁手動面板代替 API：複製或下載提示詞給聊天模型，再貼回完整 JSON。無需 API Key；若未匯入詞典，必須啟用實驗性漢字詞或外來語 LLM 補全。可搭配全部審核，否則只處理歧義候選。內容較多時分批；等候回填無 API 逾時限制，重新整理或離開頁面會取消。下次標註生效。'],
 en:['Manual chat review (copy prompt / paste result)','On by default. Enables review and replaces API calls with an on-page panel: copy or download the prompt for a chat model, then paste its complete JSON answer. No API key is needed; without an imported dictionary, enable experimental Hanja or loanword origins. Combine with Review all candidates to review locally certain words too. Larger tasks are split into batches. Waiting has no API timeout; reloading or leaving the page cancels the task. Applies to new tasks.'],
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
const sharedBudgetLabels={
 'zh-CN':'API 与手动审核共用输出预算（默认开启）',
 'zh-TW':'API 與手動審核共用輸出預算（預設開啟）',
 en:'Share the manual output budget with API (on by default)',
 ja:'API と手動審査の出力予算を共有（初期設定オン）',
 ko:'API와 수동 검토의 출력 예산 공유 (기본 켜짐)'
};
for(const [locale,label] of Object.entries(sharedBudgetLabels))copy[locale].matchManualOutputBudget=label;
copy['zh-CN'].apiOutputTokenLimitLabel='独立 API 输出上限（关闭共用时生效）';
copy.en.apiOutputTokenLimitLabel='Separate API output ceiling (when sharing is off)';
copy['zh-CN'].outputTokenLimitHint='共用时，API 使用手动模式的输出预算上限；按预计答案与余量动态设置每次 API max_tokens，而非占满上限。超过服务商真实输出限制仍可能失败，可关闭共用并降低 API 上限。手动值不改变聊天平台本身的回复上限。下一次标注生效。';
copy.en.outputTokenLimitHint='When shared, API uses the manual output ceiling and asks for only the estimated answer plus slack, not the full ceiling. Provider output limits still apply; disable sharing and lower the API cap if needed. Manual settings cannot change the chat app output cap. Applies to the next task.';
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
 'zh-CN':['词性过滤（本地及送审，默认开启）','开启时，本地候选生成及模型送审均过滤明确不匹配的词性；关闭后保留跨词性候选供语义消歧，避免误判为唯一词源。NNB 的特殊规则仅开启时生效，下次标注生效。'],
 'zh-TW':['詞性過濾（本機及送審，預設開啟）','開啟時本機候選及模型送審均過濾明確不相符的詞性；關閉時保留跨詞性候選供語義消歧，避免誤判為唯一詞源。NNB 特殊規則僅開啟時生效，下次標註生效。'],
 en:['Filter dictionary candidates by POS (on by default)','Applies to both local dictionary analysis and model review. Disable to keep cross-POS senses for contextual disambiguation and avoid treating a pruned origin as unique. NNB handling applies only when enabled. Applies to new tasks.'],
 ja:['品詞フィルター（ローカルとモデル審査、初期設定は有効）','ローカル辞書候補生成と API・手動審査に共通で適用されます。無効時は品詞の異なる候補を残して文脈で判定し、唯一の語源と早合点しません。次の処理から適用。'],
 ko:['품사 필터 (로컬 및 모델 검토, 기본 켜짐)','로컬 사전 후보와 API·수동 검토에 모두 적용됩니다. 끄면 품사가 다른 뜻풀이도 남겨 문맥으로 판단하며, 유일한 어원으로 자동 확정하지 않습니다. 다음 작업부터 적용됩니다.']
};
for(const [locale,labels] of Object.entries(reviewPosCopy))Object.assign(copy[locale],{reviewPosFilter:labels[0],reviewPosFilterHint:labels[1]});
const preloadCopy={"zh-CN": ["浏览器启动时预加载（默认开启）", "提前加载本地词典、分词器和搭配索引，减少首次等待；关闭后按需加载。"], "zh-TW": ["瀏覽器啟動時預載入（預設開啟）", "提前載入本機詞典、分詞器和搭配索引，減少首次等待；關閉後按需載入。"], "en": ["Preload at browser startup (on by default)", "Load the local dictionary, tokenizer and collocation index early to reduce the first wait. Turn off to load on demand."], "ja": ["ブラウザー起動時に事前読み込み（初期設定は有効）", "辞書・形態素解析器・共起索引を先に読み込み、初回の待ち時間を短縮します。無効時は必要になってから読み込みます。"], "ko": ["브라우저 시작 시 미리 로드 (기본 켜짐)", "로컬 사전, 형태소 분석기와 연어 색인을 미리 로드하여 첫 대기를 줄입니다. 끄면 필요할 때 로드합니다."]};
for(const [locale,labels] of Object.entries(preloadCopy))Object.assign(copy[locale],{preloadEngineOnStartup:labels[0],preloadEngineHint:labels[1]});

const experimentalCopy={
 'zh-CN':{
  experimentalHanja:'实验性：直接补全汉字词源（默认开启）',
  experimentalHanjaHint:'同一轮模型审核中，若原词典没有合适义项且词源可靠，可直接在 results 的 choice_id 写入汉字，不再使用 experimental_options 或 x0，也无需先选 KEEP。本地验证音节对齐、词界与姓名保护。',
  experimentalLoanword:'实验性：直接补全外来语原词（默认开启）',
  experimentalLoanwordHint:'同一轮审核中可在 choice_id 直接填写真实借词原文的拉丁字拼写，而不是翻译。现有 c0/n0/KEEP 仍可选；本地严格校验词界与字符。不生成额外候选数组。'
 },
 'zh-TW':{
  experimentalHanja:'實驗性：直接補全漢字詞源（預設開啟）',
  experimentalHanjaHint:'同輪審核時，若原字典沒有合適義項且詞源可靠，可在 results.choice_id 直接寫漢字。不使用 experimental_options 或 x0，也不需要先選 KEEP；本地驗證對齊、詞界與姓名保護。',
  experimentalLoanword:'實驗性：直接補全外來語原文（預設開啟）',
  experimentalLoanwordHint:'同輪審核可在 choice_id 直接填入真正的借詞拉丁字拼寫，不做英文翻譯。原 c0/n0/KEEP 仍可使用，本機檢查格式與詞界。'
 },
 en:{
  experimentalHanja:'Experimental: literal Hanja origins (on by default)',
  experimentalHanjaHint:'In one model response, if no dictionary sense fits and the true origin is known, write Hanja directly in results.choice_id. No experimental_options, x0 or preliminary KEEP step. Local alignment, name and boundary checks still apply.',
  experimentalLoanword:'Experimental: literal loanword originals (on by default)',
  experimentalLoanwordHint:'Write the actual borrowed Latin-script original directly in choice_id when no supplied sense fits, never an English translation. Existing c0/n0/KEEP selections still work; all origins are checked locally.'
 },
 ja:{
  experimentalHanja:'実験：漢字語源を直接指定（初期設定は有効）',
  experimentalHanjaHint:'辞書の候補が適切でなく語源に確証がある場合、同じ results.choice_id に漢字を直接記入します。別の候補配列や KEEP 後の再審査は不要です。アライメント・人名を検証します。',
  experimentalLoanword:'実験：外来語の原綴りを直接指定（初期設定は有効）',
  experimentalLoanwordHint:'真の借用元のラテン文字表記を choice_id に直接記入します。英訳ではありません。既存の選択肢は引き続き使用できます。'
 },
 ko:{
  experimentalHanja:'실험: 한자 어원 직접 선택 (기본 켜짐)',
  experimentalHanjaHint:'사전 후보가 맞지 않고 실제 어원을 확실히 알 때 같은 results.choice_id에 한자를 직접 작성합니다. 별도 배열이나 KEEP 후 재검토가 필요하지 않습니다. 정렬·인명·경계를 확인합니다.',
  experimentalLoanword:'실험: 외래어 원어 직접 선택 (기본 켜짐)',
  experimentalLoanwordHint:'실제 차용어의 라틴 문자 원어를 choice_id에 직접 작성합니다. 영문 번역을 대신 쓰지 않습니다. 기존 사전 선택지도 그대로 사용합니다.'
 }
};
for(const [locale,labels] of Object.entries(experimentalCopy))Object.assign(copy[locale],labels);
const segmentationCopy={
 'zh-CN':['实验性：LLM 智能分词修复（默认开启）','开启后，完整韩语句子、Kiwi 分词线索和已由本地确定的词也会提交至你选择的模型服务，可能明显增加费用。模型在同一轮审核中检查错分与漏词；仅通过本地校验的修复会生效。模型自行提供的未核实词源会用虚线标记。'],
 'zh-TW':['實驗性：LLM 智慧斷詞修復（預設開啟）','開啟時會把完整韓語句子、Kiwi 斷詞線索及本地已確定的詞送交指定模型，可能增加費用。一次請求同時校正斷詞與漏詞，修復須通過本地驗證；模型自寫的未核實詞源會有虛線標記。'],
 en:['Experimental: LLM segmentation repair (on by default)','When enabled, complete Korean sentences, Kiwi token hints and locally decided words are also sent to your chosen model provider, potentially increasing costs. The same request checks incorrect boundaries and missing words; only locally validated repairs apply. Unverified model-origin spellings are visibly marked.'],
 ja:['実験：LLM による分かち書き修正（初期設定は有効）','有効にすると、韓国語の全文、Kiwi の解析情報、ローカルで確定した語も指定先モデルに送信され、費用が増える場合があります。同じリクエストで語境界や漏れを確認し、検証済みの修正のみ適用します。未確認のモデル語源は区別して表示します。'],
 ko:['실험: LLM 지능형 형태소 경계 수정 (기본 켜짐)','활성화하면 한국어 원문 전체, Kiwi 형태소 정보 및 로컬에서 결정된 단어도 선택한 모델 제공업체에 전송되므로 비용이 늘 수 있습니다. 한 번의 요청으로 분절·누락을 검사하고 검증된 수정만 적용합니다. 모델이 생성한 미확인 어원은 따로 표시합니다.']
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
 'zh-CN':['模型直填汉字读音校验（默认关闭）','仅校验模型在实验性功能中直接填写的汉字词源的韩语读音与词首音变；词典提供的 c/n 选项不受此开关影响，也不会被该读音表再次否决。开启可能因多音字、数字后单位等情况误判；关闭仅跳过模型直填汉字的读音比对，字形、词界、位置、人名保护仍然执行。此校验不能证明词源正确。'],
 'zh-TW':['模型直填漢字讀音驗證（預設關閉）','僅驗證模型在實驗性功能中直接填寫之漢字詞源的韓語讀音及頭音法則；字典提供的 c/n 選項不受此開關影響，也不會被讀音表再次否決。開啟可能誤判多音字及數字後的單位；關閉僅略過模型直填漢字的讀音比對，字形、詞界、位置及人名保護仍然執行。此驗證無法證明詞源正確。'],
 en:['Check model-written Hanja readings (off by default)','Applies Korean reading and initial-sound checks ONLY to Hanja spellings written directly by the model in experimental origin mode. Dictionary c/n choices are never rejected by this reading table. Enabling may falsely reject polyphonic Hanja or units after numbers. Turning off skips only this reading comparison; script, word boundaries, spans and personal-name safeguards remain. A match does not prove the etymology.'],
 ja:['モデル直記漢字の読みを検証（初期設定はオフ）','実験的な語源補完でモデルが直接入力した漢字にだけ、韓国語の読みと頭音法則の照合を適用します。辞書の c/n 選択肢には適用せず、読み表を理由に拒否しません。有効時は多音字や数字に続く単位を誤判定する場合があります。オフでも字種・語境界・位置・人名保護は有効です。読みの照合だけでは語源の正しさは証明できません。'],
 ko:['모델 직접 입력 한자 독음 검사 (기본 꺼짐)','실험적 어원 기능에서 모델이 직접 작성한 한자에만 한국어 독음과 두음법칙 검사를 적용합니다. 사전의 c/n 선택지는 이 검사로 다시 거부하지 않습니다. 켜면 다음자 및 숫자 뒤 단위를 오판할 수 있습니다. 꺼도 문자 유형, 단어 경계, 위치 및 인명 보호는 유지됩니다. 독음 검사가 어원 정확성을 증명하지는 않습니다.']
};
for(const [locale,labels] of Object.entries(readingCopy))Object.assign(copy[locale],{hanjaReadingCheck:labels[0],hanjaReadingCheckHint:labels[1]});
for(const [locale,labels] of Object.entries({"en":{"switchHeading":"Dictionary / model review switches","resetSwitches":"Restore switch defaults","resetDone":"The dictionary/model switches were restored; profiles, batch size, keys and logs were preserved."},"zh-CN":{"switchHeading":"词典与模型审核选项","resetSwitches":"恢复这些选项的默认值","resetDone":"已恢复本框内选项；每批容量、模型配置、密钥、词典和日志均未更改。"},"zh-TW":{"switchHeading":"詞典與模型審核選項","resetSwitches":"還原這些選項的預設值","resetDone":"已還原此框的選項；批次容量、模型設定、密鑰、詞典及日誌均未變更。"},"ja":{"switchHeading":"辞書・モデル審査オプション","resetSwitches":"この項目の初期値に戻す","resetDone":"この枠内の設定のみ初期値に戻しました。バッチ容量やプロファイル・辞書・ログは変更していません。"},"ko":{"switchHeading":"사전 및 모델 검토 옵션","resetSwitches":"이 항목 기본값 복원","resetDone":"이 상자 안의 설정만 기본값으로 복원했습니다. 배치 용량·API 프로필·사전·로그는 유지합니다."}}))Object.assign(copy[locale],labels);
for(const [locale,message] of Object.entries({
 en:'Review strategy saved. Fix the output Token limit before saving other settings.',
 'zh-CN':'审核策略已单独保存。请修正输出 Token 限额后再保存其他设置。',
 'zh-TW':'審核策略已單獨儲存。請修正輸出 Token 上限後再儲存其他設定。',
 ja:'審査方式は保存しました。ほかの設定を保存する前に出力 Token 上限を修正してください。',
 ko:'검토 방식은 저장했습니다. 다른 설정을 저장하기 전에 출력 토큰 제한을 수정하세요.'
}))copy[locale].reviewStrategySavedWithInvalidTokens=message;
const t=key=>(copy[$('uiLocale').value]||copy.en)[key];
function syncOutputInputs(){$('apiOutputTokenLimit').disabled=$('matchManualOutputBudget').checked;}
// Model-written Hanja reading verification is subordinate to experimental Hanja.
// Hiding it also clears any stale saved opt-in from this settings UI.
function syncHanjaReadingCheckUI(){
 const available=$('experimentalHanja').checked;
 $('hanjaReadingCheckRow').hidden=!available;
 $('hanjaReadingCheck').disabled=!available;
 if(!available)$('hanjaReadingCheck').checked=false;
}

function translate(){for(const el of document.querySelectorAll('[data-engine-i18n]'))el.textContent=t(el.dataset.engineI18n);}
// Synchronize the UI *before* any unrelated field can fail validation.
// Old both-off settings become retry; old both-on settings prefer discard.
function syncReviewStrategyUI(changed){
 if(changed==='discardInvalidReviewResults')
  $('retryInvalidDictionaryChoices').checked=!$('discardInvalidReviewResults').checked;
 else if(changed==='retryInvalidDictionaryChoices')
  $('discardInvalidReviewResults').checked=!$('retryInvalidDictionaryChoices').checked;
 else if($('retryInvalidDictionaryChoices').checked===$('discardInvalidReviewResults').checked)
  $('retryInvalidDictionaryChoices').checked=!$('discardInvalidReviewResults').checked;
}
async function save(changed){
 syncReviewStrategyUI(changed);
 if(['reviewAllCandidates','manualModelReview','experimentalHanja','experimentalLoanword','smartSegmentation'].includes(changed)&&$(changed).checked)$('enableModelReview').checked=true;
 if(changed==='enableModelReview'&&!$('enableModelReview').checked){$('reviewAllCandidates').checked=false;$('manualModelReview').checked=false;$('experimentalHanja').checked=false;$('experimentalLoanword').checked=false;$('smartSegmentation').checked=false;}
 syncHanjaReadingCheckUI();
 const apiLimit=Number($('apiOutputTokenLimit').value),manualLimit=Number($('manualOutputTokenLimit').value);
 if(!Number.isSafeInteger(apiLimit)||apiLimit<1024||apiLimit>1000000||
    !Number.isSafeInteger(manualLimit)||manualLimit<1024||manualLimit>1000000){
  // A review-mode change must not be blocked by an unrelated invalid token
  // field: persist only the two switches, leaving other settings unchanged.
  if(changed==='retryInvalidDictionaryChoices'||changed==='discardInvalidReviewResults'){
   await chrome.storage.local.set({
    retryInvalidDictionaryChoices:$('retryInvalidDictionaryChoices').checked,
    discardInvalidReviewResults:$('discardInvalidReviewResults').checked
   });
   status.textContent=t('outputTokenLimitError')+'\n'+t('reviewStrategySavedWithInvalidTokens');
  }else if(changed==='experimentalHanja'||changed==='hanjaReadingCheck'){
   // Unrelated invalid token limits must not silently leave dependent switches stale.
   await chrome.storage.local.set({
    experimentalHanja:$('experimentalHanja').checked,
    hanjaReadingCheck:$('hanjaReadingCheck').checked,
    enableModelReview:$('enableModelReview').checked
   });
   status.textContent=t('outputTokenLimitError');
  }else status.textContent=t('outputTokenLimitError');
  return;
 }
 syncOutputInputs();await chrome.storage.local.set({preloadEngineOnStartup:$('preloadEngineOnStartup').checked,reviewPosFilter:$('reviewPosFilter').checked,nameProtection:$('nameProtection').checked,filterDictionaryPeople:$('filterDictionaryPeople').checked,enableModelReview:$('enableModelReview').checked,reviewAllCandidates:$('reviewAllCandidates').checked,manualModelReview:$('manualModelReview').checked,reviewLocalConversions:$('reviewLocalConversions').checked,retryInvalidDictionaryChoices:$('retryInvalidDictionaryChoices').checked,discardInvalidReviewResults:$('discardInvalidReviewResults').checked,experimentalHanja:$('experimentalHanja').checked,experimentalLoanword:$('experimentalLoanword').checked,hanjaReadingCheck:$('hanjaReadingCheck').checked,smartSegmentation:$('smartSegmentation').checked,matchManualOutputBudget:$('matchManualOutputBudget').checked,batchContextTier:normalizeBatchContextTier($('batchContextTier').value),apiOutputTokenLimit:apiLimit,manualOutputTokenLimit:manualLimit});show({imported:importedDictionary});status.textContent=t('saved')+'\n'+status.textContent;
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
for(const key of ['enableModelReview','reviewAllCandidates','manualModelReview','experimentalHanja','experimentalLoanword','hanjaReadingCheck','smartSegmentation','matchManualOutputBudget','reviewLocalConversions','retryInvalidDictionaryChoices','discardInvalidReviewResults','batchContextTier','apiOutputTokenLimit','manualOutputTokenLimit','nameProtection','filterDictionaryPeople','reviewPosFilter','preloadEngineOnStartup'])$(key).addEventListener('change',()=>save(key).catch(e=>status.textContent=e.message));
$('importDictionary').addEventListener('click',async()=>{const file=$('dictionaryFile').files?.[0];if(!file){status.textContent=t('missing');return;}busy(true);status.textContent=t('busy');try{await importBrowserDictionary(file);await refreshDictionaryStatus();chrome.runtime.sendMessage({type:'KRA_PRELOAD_ENGINE'}).catch(()=>{});}catch(e){status.textContent=e.message;}finally{busy(false);}});
$('clearDictionary').addEventListener('click',async()=>{busy(true);try{await clearBrowserDictionary();await refreshDictionaryStatus();}catch(e){status.textContent=e.message;}finally{busy(false);}});
$('resetEngineSwitches').addEventListener('click',async()=>{
 const button=$('resetEngineSwitches');button.disabled=true;
 try{
  await chrome.storage.local.set({...ENGINE_SWITCH_DEFAULTS});
  for(const [key,value] of Object.entries(ENGINE_SWITCH_DEFAULTS))$(key).checked=value;
  syncHanjaReadingCheckUI();
  show({imported:importedDictionary});
  status.textContent=t('resetDone')+'\n'+status.textContent;
 }catch(e){status.textContent=e.message;}finally{button.disabled=false;}
});
$('uiLocale').addEventListener('change',()=>{translate();show({imported:importedDictionary});});
chrome.storage.local.get(['enableModelReview','reviewAllCandidates','manualModelReview','experimentalHanja','experimentalLoanword','hanjaReadingCheck','smartSegmentation','matchManualOutputBudget','reviewLocalConversions','retryInvalidDictionaryChoices','discardInvalidReviewResults','batchContextTier','apiOutputTokenLimit','manualOutputTokenLimit','nameProtection','filterDictionaryPeople','reviewPosFilter','preloadEngineOnStartup','uiSettings']).then(async s=>{const defaults=engineSwitchValues(s);$('preloadEngineOnStartup').checked=defaults.preloadEngineOnStartup;$('reviewPosFilter').checked=defaults.reviewPosFilter;$('nameProtection').checked=defaults.nameProtection;$('filterDictionaryPeople').checked=defaults.filterDictionaryPeople;$('reviewAllCandidates').checked=defaults.reviewAllCandidates;$('manualModelReview').checked=defaults.manualModelReview;$('reviewLocalConversions').checked=defaults.reviewLocalConversions;$('retryInvalidDictionaryChoices').checked=defaults.retryInvalidDictionaryChoices;$('discardInvalidReviewResults').checked=defaults.discardInvalidReviewResults;$('experimentalHanja').checked=defaults.experimentalHanja;$('experimentalLoanword').checked=defaults.experimentalLoanword;$('hanjaReadingCheck').checked=defaults.hanjaReadingCheck;syncHanjaReadingCheckUI();$('smartSegmentation').checked=defaults.smartSegmentation;$('matchManualOutputBudget').checked=s.matchManualOutputBudget!==false;$('batchContextTier').value=normalizeBatchContextTier(s.batchContextTier);$('apiOutputTokenLimit').value=Number.isSafeInteger(s.apiOutputTokenLimit)&&s.apiOutputTokenLimit>=1024&&s.apiOutputTokenLimit<=1000000?s.apiOutputTokenLimit:16384;$('manualOutputTokenLimit').value=Number.isSafeInteger(s.manualOutputTokenLimit)&&s.manualOutputTokenLimit>=1024&&s.manualOutputTokenLimit<=1000000?s.manualOutputTokenLimit:65536;$('enableModelReview').checked=defaults.enableModelReview||defaults.reviewAllCandidates||defaults.manualModelReview||defaults.experimentalHanja||defaults.experimentalLoanword||defaults.smartSegmentation;if(s.enableModelReview===undefined)await chrome.storage.local.set({preloadEngineOnStartup:$('preloadEngineOnStartup').checked,reviewPosFilter:$('reviewPosFilter').checked,nameProtection:$('nameProtection').checked,enableModelReview:$('enableModelReview').checked});if(s.uiSettings?.uiLocale)$('uiLocale').value=s.uiSettings.uiLocale;syncOutputInputs();translate();await refreshDictionaryStatus();}).catch(e=>status.textContent=e.message);translate();
