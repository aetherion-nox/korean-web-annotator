# 韩语网页标注器

**简体中文** · [English](README.en.md) · [日本語](README.ja.md) · [한국어](README.ko.md)

为韩语网页显示汉字词和外来语原词：汉字词正文显示汉字、上方保留谚文；外来语正文保留韩文、上方显示原词。

导入词典后，插件在浏览器内完成基础标注。也可连接云端或兼容的本地大模型 API，根据上下文判断本地算法未能确定的词源或词义，或主动重审选中文字。大模型功能可选，基础标注无需 API。

## 安装与更新

1. 在 [Release](https://github.com/aetherion-nox/korean-web-annotator/releases/tag/v1.1.0) 的 **Assets** 下载 `Korean-Web-Annotator-v1.1.0.zip`，解压。
2. Chrome 打开 `chrome://extensions`，开启“开发者模式”，点击“加载已解压的扩展程序”，选择 `manifest.json` 所在文件夹。手机 Quetta 使用其扩展加载功能。
3. 更新时替换原插件文件，重新加载插件，并刷新网页。

请下载 Release 中的完整安装包，无需 Python。

## 导入词典

1. 从同一 Release 的 **Assets** 下载 [hanja_dict.zip](https://github.com/aetherion-nox/korean-web-annotator/releases/download/v1.1.0/hanja_dict.zip)。
2. **先解压**得到 `hanja_dict.db`。
3. 打开“引擎 / API 设置”，选择 DB 文件，点击“导入词典”。

也可从[韩国语基础词典官网](https://krdict.korean.go.kr/download/downloadPopup)下载官方 JSON ZIP，直接导入，无需解压。两种方式任选一种。

## 日常使用

- 点击插件、网页工具条或右键菜单中的“标注整页”；也可选中文字后标注选区。
- “撤销”取消上次标注，“还原”恢复原文。
- “选择与复制文字时”可选择：当前正文、正文和标注、原韩语（默认）、只复制上方标注。
- 勾选“本次忽略缓存，重新分析文本”，下次处理时不复用已有标注缓存。
- 工具条可设为“选中文字时显示”或“始终显示”。同时开启“仅检测到谚文时显示工具条”时，选区模式仅在选中文字包含谚文或已标注的韩语词时显示。

## 大模型 API（可选）

内置以下服务商和模型，可在设置页直接选择：

| 服务商 | 模型 |
| --- | --- |
| OpenAI | GPT-6.1 Sol / GPT-6 Astra / GPT-6 Luna |
| Claude (Anthropic) | Sonnet 5.5 / Opus 5.5 / Haiku 5.5 / Fable 5.1 |
| GLM (Z.AI) | GLM-5.3 / GLM-5.3-Flash / GLM-5.3-FlashX |
| Xiaomi MiMo | MiMo-V2.6-Flash / V2.6-Pro / V2.6-Pro-Ultraspeed / V2.5 / V2.5-Pro |
| DeepSeek | deepseek-flash / deepseek-v4-pro |
| 自定义 | 手动填写支持 OpenAI Chat Completions 格式的接口地址、模型名和 API Key |

选择服务商和模型、填写 API Key，点击“保存设置”，再用“测试 API”检查。思考开关和强度按模型能力显示；自定义模型使用服务端默认思考设置。兼容服务需填写完整接口地址，通常以 `/chat/completions` 结尾。

- **审核**：在“引擎 / API 设置”中开启后，大模型处理普通标注中本地算法未解决的歧义；开关切换后自动保存。
- **模型重审选区**：主动让模型重新判断选中文字，需要 API，但不必开启“审核”。

使用大模型功能时，相关文本和词典候选会发送到所配置的 API；云端调用费用由对应服务商收取。

## 致谢与词典来源

- [Arrow36 / Hangul-Hanja-mixed-script](https://github.com/Arrow36/Hangul-Hanja-mixed-script)：直接使用并适配了其韩语汉字转换与词典处理代码。
- [Furiganator（Chrome 商店）](https://chromewebstore.google.com/detail/furiganator/ijfcmmkkmogaclaafpgcjdfcfibmhcfa)：为日语网页添加假名注音的扩展，参考了其标注显示与文字选择方式。
- 感谢 Kiwi、Pyodide 和韩国国立国语院。

预生成 DB 来自国立国语院《韩国语基础词典》2026-09-19 官方快照，为非官方转换版；文字数据按 [CC BY-SA 2.0 KR](https://creativecommons.org/licenses/by-sa/2.0/kr/) 发布。媒体链接的许可另行适用。
