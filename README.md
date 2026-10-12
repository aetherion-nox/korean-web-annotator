# 韩语网页标注器 1.0.3

**简体中文** · [English](README.en.md) · [日本語](README.ja.md) · [한국어](README.ko.md)

为韩语网页标注汉字词和外来语原词，帮助阅读韩语。导入词典后即可在浏览器内使用，无需启动本地服务器；也可自行配置 API，启用大模型审核。

## 安装

1. 打开 [Releases](https://github.com/aetherion-nox/korean-web-annotator/releases)，在 1.0.3 正式版的 **Assets** 中下载 `Korean-Web-Annotator-v1.0.3.zip`。
2. 解压 ZIP。安装包包含完整运行时，无需安装 Python，也无需运行还原脚本。
3. Chrome 打开 `chrome://extensions`，开启“开发者模式”，点击“加载已解压的扩展程序”，选择 `manifest.json` 所在文件夹。手机 Quetta 使用其扩展加载功能。

更新后重新加载插件，并刷新已打开的网页。

若下载的是 **Code → Download ZIP** 源码包，则需 Python 3.10 或以上，在解压后的文件夹中先运行 `python restore_distribution.py`，再加载插件。

## 导入词典

从[韩国语基础词典官网](https://krdict.korean.go.kr/download/downloadPopup)下载 JSON 格式的词典 ZIP，在插件的“引擎 / API 设置”中导入，无需先解压。词典需自行下载。

手机导入较慢时，可先在电脑上转换为 DB：

```sh
python python/backend/upstream/scripts/import_dictionary.py "你的词典.zip"
```

将生成的 `python/backend/upstream/hanja_dict.db` 传到手机，再在同一设置页导入。

## 使用

- 打开韩语网页，点击插件里的“标注整页”，或通过工具条、右键菜单开始标注。
- 选中文字可进行选区标注或重新标注；需要恢复时使用“撤销”或“还原”。
- 在“选择与复制文字时”选择复制方式：当前正文、正文和标注、原韩语（默认），或上方标注。
- **审核**：普通标注时，让大模型处理本地算法未能解决的歧义。需要配置服务商、模型和 API Key，并开启审核。
- **模型重标（模型重审选区）**：选中文字后，主动交给大模型重新判断。同样需要配置大模型 API，但无需开启“审核”。
- 只使用本地算法标注时，无需大模型 API。

## 致谢

- [Arrow36 / Hangul-Hanja-mixed-script](https://github.com/Arrow36/Hangul-Hanja-mixed-script)：本插件直接使用并适配了该项目的韩语汉字转换及词典处理代码，感谢作者的开源贡献。
- [Furiganator（Chrome 商店）](https://chromewebstore.google.com/detail/furiganator/ijfcmmkkmogaclaafpgcjdfcfibmhcfa)：为日语网页添加假名注音的扩展。本插件的标注显示和文字选择方式参考了它。
- 感谢 Kiwi、Pyodide 和韩国国立国语院提供的工具与词典资源。
