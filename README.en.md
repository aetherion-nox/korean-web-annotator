# Korean Web Annotator

[简体中文](README.md) · **English** · [日本語](README.ja.md) · [한국어](README.ko.md)

Read Korean pages with Hanja in the main text and original Hangul above it, or loanword origins above unchanged Korean. Import a dictionary to annotate locally; no server or model API is required.

## Install and update

1. Download `Korean-Web-Annotator-v1.1.0.zip` from **Assets** on the [Release page](https://github.com/aetherion-nox/korean-web-annotator/releases/tag/v1.1.0) and extract it.
2. In Chrome, open `chrome://extensions`, enable **Developer mode**, choose **Load unpacked**, and select the folder containing `manifest.json`. On mobile, use Quetta's extension loading feature.
3. To update, replace the extension files, reload the extension, and refresh web pages.

Use the complete Release package; Python is not required.

## Import a dictionary

1. Download [hanja_dict.zip](https://github.com/aetherion-nox/korean-web-annotator/releases/download/v1.1.0/hanja_dict.zip) from the same Release's **Assets**.
2. **Extract it first** to obtain `hanja_dict.db`.
3. In **Engine / API settings**, select the DB and click **Import dictionary**.

Alternatively, download the official JSON ZIP from the [Korean Basic Dictionary](https://krdict.korean.go.kr/download/downloadPopup) and import it directly without extracting it. Use either method.

## Everyday use

- Annotate a page from the extension, page toolbar, or context menu; select text to annotate a selection.
- **Undo** cancels the last annotation; **Restore** returns to the original text.
- Copy the displayed body, body plus annotations, original Korean (default), or annotations only.
- **Ignore cache and analyze the text again** reruns text processing.

## Model API (optional)

Choose from these built-in providers and models:

| Provider | Models |
| --- | --- |
| OpenAI | GPT-6.1 Sol / GPT-6 Astra / GPT-6 Luna |
| Claude (Anthropic) | Sonnet 5.5 / Opus 5.5 / Haiku 5.5 / Fable 5.1 |
| GLM (Z.AI) | GLM-5.3 / GLM-5.3-Flash / GLM-5.3-FlashX |
| Xiaomi MiMo | MiMo-V2.6-Flash / V2.6-Pro / V2.6-Pro-Ultraspeed / V2.5 / V2.5-Pro |
| DeepSeek | deepseek-flash / deepseek-v4-pro |
| Custom | Enter an OpenAI Chat Completions-compatible endpoint, model name, and API key |

Select a provider and model, enter your API key, **Save settings**, then **Test API**. Thinking controls reflect model capabilities; custom models use server defaults. Compatible endpoints need the full URL, usually ending in `/chat/completions`.

- **Model review** resolves ambiguities left by local processing during normal annotation.
- **Review selection** explicitly asks the model to reconsider selected text. It needs an API configuration, but the model-review switch can remain off.

## Acknowledgements and dictionary source

- [Arrow36 / Hangul-Hanja-mixed-script](https://github.com/Arrow36/Hangul-Hanja-mixed-script): its Korean Hanja conversion and dictionary-processing code is directly used and adapted.
- [Furiganator (Chrome Web Store)](https://chromewebstore.google.com/detail/furiganator/ijfcmmkkmogaclaafpgcjdfcfibmhcfa): a Japanese furigana extension that inspired annotation display and text selection.
- Thanks to Kiwi, Pyodide, and the National Institute of Korean Language.

The prepared DB is an unofficial conversion of the Institute's Korean Basic Dictionary snapshot dated 2026-09-19. Text data: [CC BY-SA 2.0 KR](https://creativecommons.org/licenses/by-sa/2.0/kr/). Linked media have separate licensing.
