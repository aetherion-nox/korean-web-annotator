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

**New-install defaults and single-syllable protection:** Optional model review, preloading, name protection, experimental Hanja/foreign-origin proposals, resegmentation and manual chat review start enabled; POS filtering and review-all start disabled. A new enabled-by-default guard prevents local conversion of single Hangul syllables, while allowing existing dictionary choices to be reviewed by a model. Without valid review, Hangul remains. Explicit saved preferences are preserved.

**v1.1.61 risk review:** The enabled-by-default unique-candidate risk review defers weak-evidence short homophones and unlisted Kiwi-split compounds before local conversion. Verified complete mixed-origin headwords such as 팀장 → team長 may still be converted locally. Overlapping resegmentation and dictionary reviews are merged into one model task. Missing or invalid model answers leave Korean unchanged. This is a heuristic, not proof of semantic accuracy.

**v1.1.62 lexical-boundary safety:** Dictionary subword matches no longer authorize converting a longer unbroken Hangul word. Unsupported partial-word model answers safely fall back to KEEP, and irrelevant synthetic foreign-origin prefixes are rejected. Resegmentation prioritizes evidenced boundary errors instead of scanning all menu items. Up to 64 model decisions per batch, with no global target truncation.

**v1.1.63 large-context batching:** The arbitrary 64-decision cap is removed. 512K/1M tiers keep all targets in one batch when prompt, estimated JSON reply and safety margin fit. Configure API max output tokens per profile (default 16,384) and manual chat reply budget separately (default 65,536); real provider limits still apply.

**v1.1.64 recovery for out-of-dictionary compounds:** With experimental model resegmentation and origin generation enabled, contiguous nominal compounds and unlisted nominal headwords may be reviewed even with no exact dictionary entry or component records. The model can combine verified component readings with high-confidence origins for missing parts. No country- or institution-specific word list is required. Confirmed personal names stay protected; all generated positions and origins are validated, and uncertain items remain in Korean.

**v1.1.65 incremental repair:** A generated subword with a single unambiguous match within its original target can have inaccurate start/end corrected locally. Isolated one-syllable readings require matching dictionary evidence and actual Kiwi nominal/particle boundaries. Manual review preserves already validated decisions and produces a smaller repair prompt; respond with only failed target IDs and the same batch_id. Ungrounded foreign personal-name guesses remain blocked.

**v1.1.66 unified validation and partial repair:** Model review and browser-offline recovery now share the same generated-origin validator. Invalid choices report individual target IDs and reasons, while valid decisions survive retries; submit only missing/failed IDs using the original batch_id. Identical source/replacement segments become safe no-ops, and a dictionary-attested single-syllable noun can follow a verified attributive modifier. Consecutive clickable navigation items retain logical word boundaries.

When API review is enabled, relevant page text and dictionary candidates are sent to your configured provider. Consider privacy and API charges.

**v1.1.67 mixed-result recovery:** Unknown IDs no longer discard unrelated valid decisions in automatic or manual reviews. Duplicate IDs invalidate only their own target; accepted decisions remain saved. Repair-prompt JSON examples now use an actual outstanding target ID instead of a hard-coded t0. A mismatched batch_id still rejects the submission.

## 5. Troubleshooting

- **Nothing happens:** Check that the dictionary was imported, reload the extension, and refresh the page.
- **An old error persists after updating:** Reload in `chrome://extensions` and refresh the existing tab; old tabs may still run the previous content script.
- **Manual review has unfinished batches:** Keep the tab open and submit/validate each JSON batch before refreshing.

[Release notes and downloads](https://github.com/aetherion-nox/korean-web-annotator/releases) · [Privacy](PRIVACY.md) · [Third-party notices](THIRD_PARTY_NOTICES.md)
