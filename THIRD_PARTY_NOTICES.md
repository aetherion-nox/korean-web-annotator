# Third-party code

## Arrow36 / Hangul-Hanja-mixed-script

Source: https://github.com/Arrow36/Hangul-Hanja-mixed-script

This extension incorporates and adapts its Korean Hanja conversion and dictionary-processing code, including the upstream modules in `python/backend/upstream/` and their embedded copies in `runtime/python-sources.json`. Browser integration and dictionary handling have been adapted for this extension. The upstream project's GNU General Public License version 3 is included in `third_party/Arrow36-LICENSE.txt`; its terms apply to the reused code. Source code for this distribution is available in this repository.

## Other components and references

Kiwi and Pyodide are bundled runtime components; their respective upstream licenses continue to apply.

Furiganator is a Japanese furigana extension used as a reference for annotation display and text selection: https://chromewebstore.google.com/detail/furiganator/ijfcmmkkmogaclaafpgcjdfcfibmhcfa

Dictionary data is obtained separately from the National Institute of Korean Language: https://krdict.korean.go.kr/download/downloadPopup

## Bundled Kiwi 0.24.1

kiwi-nlp 0.24.1 (WASM/JavaScript) and the official Kiwi v0.24.1 CoNg-base model are bundled. Source: https://github.com/bab2min/Kiwi/tree/v0.24.1 . License: Apache-2.0; see third_party/Kiwi-LICENSE.txt. The legacy runtime metadata field kiwipiepy_model identifies the bundled model release, not an installed Python package.
