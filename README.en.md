# Korean Web Annotator 1.0.1

[简体中文](README.md) · **English** · [日本語](README.ja.md) · [한국어](README.ko.md)

Read Korean web pages with Hanja and loanword-origin annotations. After importing a dictionary, the extension runs inside your browser without a local server. Optional model review is available through your own API configuration.

## Install

1. Open [Releases](https://github.com/aetherion-nox/korean-web-annotator/releases) and download `Korean-Web-Annotator-v1.0.1.zip` from the 1.0.1 release's **Assets**.
2. Extract the ZIP. It includes the complete runtime; Python and the restoration script are not needed.
3. In Chrome, open `chrome://extensions`, enable **Developer mode**, select **Load unpacked**, and choose the folder containing `manifest.json`. On mobile, use Quetta's extension loading feature.

After updating, reload the extension and refresh open web pages.

If you download the source using **Code → Download ZIP**, install Python 3.10 or newer and run `python restore_distribution.py` in the extracted folder before loading the extension.

## Import a dictionary

Download the JSON dictionary ZIP from the [official Korean Learners' Dictionary website](https://krdict.korean.go.kr/download/downloadPopup). Import it in the extension's **Engine / API settings** without extracting it. Dictionary data must be downloaded separately.

If importing on your phone is slow, convert the ZIP on your computer first:

```sh
python python/backend/upstream/scripts/import_dictionary.py "path/to/dictionary.zip"
```

Transfer the resulting `python/backend/upstream/hanja_dict.db` to your phone and import it on the same settings page.

## Use

- Open a Korean web page and start whole-page annotation from the extension, toolbar, or context menu.
- Select text to annotate or reannotate a selection. Use undo or restore to remove annotations.
- Choose a copy mode: displayed body text, body plus annotations, original Korean (default), or annotations only.
- **Model review**: during normal annotation, the model resolves ambiguities that the local algorithm cannot settle. Configure your provider, model, and API key, then enable review.
- **Model reannotation (review selection)**: select text and explicitly ask the model to reconsider it. This also requires a configured model API, but the model-review switch can remain off.
- Local-only annotation does not require a model API.

## Acknowledgements

- [Arrow36 / Hangul-Hanja-mixed-script](https://github.com/Arrow36/Hangul-Hanja-mixed-script): this extension directly uses and adapts its Korean Hanja conversion and dictionary-processing code. Thank you for making it open source.
- [Furiganator (Chrome Web Store)](https://chromewebstore.google.com/detail/furiganator/ijfcmmkkmogaclaafpgcjdfcfibmhcfa): an extension that adds furigana to Japanese web pages. It inspired this extension's annotation display and text selection.
- Thanks to Kiwi, Pyodide, and the National Institute of Korean Language for their tools and dictionary resources.
