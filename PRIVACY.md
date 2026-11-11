# Privacy Policy — Korean Hanja & Loanword Annotator

Last updated: 2026-11-11

This policy covers Korean Hanja & Loanword Annotator (Korean Web Annotator), including the experimental v1.1.55.2.

## Local annotation
The extension reads Korean text on pages or selections you choose to annotate. Dictionary lookup, tokenization and basic annotation run locally in your browser using packaged runtimes. Imported dictionary files are stored locally in the extension's IndexedDB. The developer does not receive dictionary files or webpage text from local annotation.

## Optional model API features
Model review is optional and disabled by default. If you configure an API and enable model review, or explicitly request model reannotation, relevant webpage or selected text and dictionary candidates are sent to the API endpoint you configure. Your API key is sent to that endpoint for authentication when required. Your chosen API provider's privacy policy, retention practices and charges apply. Text may contain personal or sensitive information. Do not use these features on text you do not wish to share with that provider. Basic annotation requires no API or account.

## Experimental LLM segmentation repair
This feature is off by default. When enabled together with model review, **complete Korean sentences being annotated** may be sent to the selected model provider, including words that local processing already determined and sentences without dictionary candidates. The request also includes compact Kiwi token hints, candidate dictionary definitions, and relevant context. This increases transmitted text and may increase token charges. It does not add an extra model request round per batch.

A provider may receive content from a dynamic page again during later annotation; do not enable this feature for pages containing material you do not wish to share. Model-authored etymologies are not automatically verified by a dictionary and are marked as unverified on the page. If request logging is enabled, logs may contain page text and dictionary senses; treat exported logs as sensitive.

## Settings, API keys and caches
The extension stores interface preferences, dictionary metadata, API profiles and annotation caches in browser extension storage. Depending on your selected key-storage mode, API keys are kept for the browser session, saved locally, or saved in encrypted form. Local persistent key storage is not equivalent to encrypted storage. Cache behavior is configurable in the extension settings.

## Clipboard
Copy commands write the text you choose to the system clipboard using the configured copy mode. The extension does not send clipboard contents to the developer.

## Data sharing and tracking
The developer does not operate an analytics or advertising collection service for this extension and does not sell user data. Relevant text is transmitted as needed for the optional API functionality you configure and invoke. User data is not used for advertising, creditworthiness or lending decisions.

## Control and removal
You can disable model review, remove API profiles, clear annotation caches and manage dictionaries through the extension. Removing the extension removes its browser-managed local storage; separately downloaded dictionary files remain on your device. For information already sent to an API provider, use that provider's data controls.

## Contact
For privacy questions, open an issue without including private text, API keys or other secrets:
https://github.com/aetherion-nox/korean-web-annotator/issues

---

# 隐私政策

本政策适用于韩语网页标注器（包括实验版 1.1.55.2），更新日期：2026-11-11。

本扩展在浏览器本地分析用户选择标注的韩语网页或选区，导入词典保存在本地。基础标注不需要账号或 API，开发者不会接收本地标注的网页文本或词典文件。

大模型审核默认关闭。配置 API 并开启审核，或主动调用模型重审时，相关文本、词典候选及必要的 API 认证信息会发送至用户设置的 API 服务。文本可能包含个人或敏感信息，使用前请确认愿意向该服务分享，并了解其隐私政策、保留规则和收费。

实验性「LLM 智能分词修复」默认关闭。开启后，当前标注范围内的**完整韩语句子**（包括原本能在本地确定的词、没有任何词典候选的句子）以及紧凑的 Kiwi 分词线索、词典释义和必要上下文，均可能发送给用户选择的模型服务商，因此文本传输量与 token 费用可能增加。按批仍只进行同一次模型审核，不新增第二轮请求。请勿在不愿向服务商分享的私密网页开启此功能；动态页面可能在后续更新时再次提交文字。模型自行编写的词源不等同于词典核实，页面将显式标记。若开启请求日志，日志也可能保留网页原文和候选释义，导出日志时请注意保密。

设置、API 配置、词典和标注缓存保存在浏览器中。API Key 可按所选模式仅保留在会话、保存在本地或加密保存；本地明文保存不等于加密。复制命令仅将所选内容写入系统剪贴板。开发者不出售用户数据，也不将其用于广告、信用或借贷决策。

用户可关闭审核、删除 API 配置、管理词典、清除缓存或卸载扩展。卸载不会删除另行下载的词典副本。已发送给 API 服务的数据请使用对应服务的数据管理机制。隐私问题可通过项目 Issues 联系，请勿提交密钥或私密文本。
