# Korean Web Annotator

[简体中文](README.md) · [繁體中文](README.zh-TW.md) · **English** · [日本語](README.ja.md) · [한국어](README.ko.md)

Annotate Korean web pages with Hanja readings and original loanword forms. Whole-page and selected-text annotation run locally in your browser; optional AI review can resolve ambiguous dictionary entries. Basic annotation needs neither an API key nor a local server.

## 1. Install the extension

1. Open [GitHub Releases](https://github.com/aetherion-nox/korean-web-annotator/releases/latest) and download the attached **`Korean-Web-Annotator-v*.zip`** (complete installation package). Do **not** use GitHub's automatically generated **Source code** ZIP.
2. Extract the ZIP. In Chrome, open `chrome://extensions`, enable **Developer mode**, click **Load unpacked**, and select the folder containing `manifest.json`.
3. On mobile, use a browser that supports unpacked extensions, such as Quetta.

After an update, reload the extension and refresh any already-open pages. You normally do not need to reimport your dictionary.

> **Installing from source:** If you use **Code → Download ZIP**, install Python 3.10+ and run `python restore_distribution.py` from the extracted directory first. This restores large runtime files omitted from the source repository. The Release attachment is ready to load without this step.

## 2. Import a dictionary

1. Download the **JSON dictionary ZIP** from the [official Korean Learners' Dictionary site](https://krdict.korean.go.kr/download/downloadPopup).
2. Open the extension's **Engine / API settings**, choose the dictionary ZIP and import it. **Do not extract the dictionary ZIP first.**

If import is slow on your phone, convert the dictionary to SQLite on your computer:

```sh
python python/backend/upstream/scripts/import_dictionary.py "path/to/dictionary.zip"
```

Transfer the generated `python/backend/upstream/hanja_dict.db` to your phone and import it on the same settings page.

## 3. Annotate and copy text

1. Open a Korean web page, click the extension icon, and enable **Hanja** and/or **loanword** annotation.
2. Click **Annotate entire page**, or select text and use **Annotate selection**, the page toolbar or the context menu.
3. Use **Undo last annotation** or **Restore all** to return to the original display. If you close the toolbar, click the draggable floating button to reopen it.
4. Under **Text selection and copying**, choose displayed text, displayed text plus annotations, **original Korean only (default)**, or annotations only.

For sites that redraw their text dynamically, leave **Restore existing annotations on dynamic pages** enabled.

## 4. Optional AI review

Dictionary-based annotation does not require AI. To review ambiguous words, open **Engine / API settings**, configure your provider, model, endpoint and API key, test the connection, save, and enable **Optional model review**.

- **Normal review:** The model handles unresolved local ambiguities. You may also enable **Review all candidates with AI**, which can increase requests and costs.
- **Review selected text again:** Select text and choose the corresponding button. A configured model API is required, but the general model-review toggle can stay off.
- **Manual chat review:** Enable it in settings. Copy or download the prompt shown in the panel, send it to a chat model, then paste or import the complete JSON response and validate/apply the current batch. **No API key is required**, but a dictionary still is.
- Adjust the **context capacity per batch** for large tasks, and enable **Annotate as results arrive** to display completed batches progressively.

**Experimental origin proposals and model resegmentation:** Three independent switches (off by default) permit the model to propose Hanja, original foreign spellings, and corrected lexical boundaries even if Kiwi split or missed a word. Resegmentation requires model review plus at least one origin-proposal switch. Hanja must have exactly one character per Korean syllable; name protection remains. Batching follows the selected context budget, without an arbitrary 120/12 target cap. Review experimental results and API costs.

When API review is enabled, relevant page text and dictionary candidates are sent to your configured provider. Consider privacy and API charges.

## 5. Troubleshooting

- **Nothing happens:** Check that the dictionary was imported, reload the extension, and refresh the page.
- **An old error persists after updating:** Reload in `chrome://extensions` and refresh the existing tab; old tabs may still run the previous content script.
- **Manual review has unfinished batches:** Keep the tab open and submit/validate each JSON batch before refreshing.

[Release notes and downloads](https://github.com/aetherion-nox/korean-web-annotator/releases) · [Privacy](PRIVACY.md) · [Third-party notices](THIRD_PARTY_NOTICES.md)
