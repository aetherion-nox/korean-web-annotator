# Korean Web Annotator 3.3.5

[简体中文](README.md) · **English** · [日本語](README.ja.md) · [한국어](README.ko.md)

Annotate Korean web pages with dictionary-backed Hanja and loanword origins. The dictionary and analysis engine run inside the extension; no local Python server is required. Optional model review uses your configured API provider.

## Install

Download and extract the installation ZIP, or download this repository. In Chrome, open `chrome://extensions`, enable Developer mode, select **Load unpacked**, and choose the directory containing `manifest.json`. In Quetta, use its extension loading feature. Reload the extension and refresh open pages after upgrading.

Open **Engine / API settings** and import an official Korean Learners' Dictionary JSON ZIP or a prebuilt `hanja_dict.db`. Download the dictionary from <https://krdict.korean.go.kr/download/downloadPopup>. Dictionary data, personal settings, and API credentials are not included in this repository.

## Build a dictionary database on your computer

Python 3.10 or newer is sufficient; the importer uses the standard library. Run from the repository root:

```sh
python python/backend/upstream/scripts/import_dictionary.py "path/to/dictionary.zip"
```

The output is `python/backend/upstream/hanja_dict.db`. Import that DB in the extension, or transfer it to your phone and import it in Quetta. Set the `HANJA_DB_PATH` environment variable to choose another output path. The importer checks entry/sense/example counts, foreign keys, snapshot dates, and SQLite integrity, then replaces the destination atomically and backs up an existing database.

Readable Python engine sources are in `python/`; the browser loads the corresponding embedded sources in `runtime/python-sources.json`. The importer and schema are extracted unchanged from that bundle.

## Use

Start whole-page annotation from the popup, toolbar, or context menu. Analysis finishes before native `ruby`/`rt` elements are inserted in one pass. The browser handles layout. The toolbar offers whole-page annotation, selection reannotation, model review of a selection, undo, diagnostics, restore, and close.

The selection/copy setting provides four modes: displayed body text; body plus annotation as `body(annotation)`; original Korean only (default); or annotation only. Selections without this extension's annotations retain normal browser copy behavior.

With no selection, the context menu supports whole-page annotation even when some text is already annotated. Select unannotated Korean to annotate the selection; select annotated text to undo the last annotation. Whole-page processing stops automatically by default. Disabling that option processes newly added text, but does not restore annotations removed by a page rewrite.

In 3.3.5, the popup sends the start request to the background immediately. Closing the popup does not cancel the handoff, and repeated clicks during startup are combined.

## Verification and references

The included verification scripts and historical logs cover rendering, copy/selection behavior, context-menu routing, caching, and popup startup. Mobile viewport tests use mocked extension interfaces and analysis results; they are not physical-device Quetta tests. Some historical test scripts refer to their original workspace and browser paths.

The native ruby insertion and annotation selection approach was informed by Furiganator 1.2.0. Bundled Kiwi and Pyodide components retain their upstream notices where present; inclusion does not change their licenses. Older change notes document historical behavior; the current README and `V3.3.5-POPUP-START.txt` describe this version.

## GitHub distribution

Large runtime assets and the original installation ZIP are stored in chunks due to the upload interface limit. Download the entire repository and run `python restore_distribution.py` before loading the extension. The script verifies SHA-256 and reconstructs all runtime files and `distribution/Korean-Web-Annotator-v3.3.5-Extension.zip`. Existing installation ZIPs do not need this step.
