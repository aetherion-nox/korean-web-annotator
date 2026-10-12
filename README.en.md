# Korean Web Annotator 3.3.5

[简体中文](README.md) · **English** · [日本語](README.ja.md) · [한국어](README.ko.md)

Read Korean web pages with Hanja and loanword-origin annotations. After importing a dictionary, the extension runs inside your browser without a local server. Optional model review is available through your own API configuration.

## Install

1. Select **Code → Download ZIP** on this page and extract the repository.
2. Install Python 3.10 or newer and run `python restore_distribution.py` in the extracted folder. If you already have a complete installation ZIP, simply extract it.
3. In Chrome, open `chrome://extensions`, enable **Developer mode**, select **Load unpacked**, and choose the folder containing `manifest.json`. On mobile, use Quetta's extension loading feature.

After updating, reload the extension and refresh open web pages.

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
- For optional model review, configure your provider, model, and API key in **Engine / API settings**, then enable review. Local annotation does not require an API key.

## Acknowledgements

Thanks to Furiganator 1.2.0 for inspiration on annotation and text selection, and to Kiwi, Pyodide, and the National Institute of Korean Language for their tools and dictionary resources.
