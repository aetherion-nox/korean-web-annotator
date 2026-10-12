# 韓国語ウェブ注釈ツール 1.1.0

[简体中文](README.md) · [English](README.en.md) · **日本語** · [한국어](README.ko.md)

韓国語のウェブページに漢字や外来語の原語を表示し、読解を支援します。辞書を取り込めばブラウザー内で動作し、ローカルサーバーは不要です。自分の API を設定してモデル審査を利用することもできます。

## インストール

1. [Releases](https://github.com/aetherion-nox/korean-web-annotator/releases) を開き、正式版 1.1.0 の **Assets** から `Korean-Web-Annotator-v1.1.0.zip` をダウンロードします。
2. ZIP を展開します。実行に必要なファイルをすべて含むため、Python のインストールや復元スクリプトの実行は不要です。
3. Chrome の `chrome://extensions` でデベロッパーモードを有効にし、「パッケージ化されていない拡張機能を読み込む」から `manifest.json` があるフォルダーを選択します。スマートフォンでは Quetta の拡張機能読み込み機能を使用します。

更新後は拡張機能を再読み込みし、開いているページを更新してください。

**Code → Download ZIP** でソースをダウンロードした場合は、Python 3.10 以降をインストールし、展開したフォルダーで `python restore_distribution.py` を実行してから読み込みます。

## 辞書の取り込み

作成済み辞書は [1.1.0 Release](https://github.com/aetherion-nox/korean-web-annotator/releases/tag/v1.1.0) の **Assets** にある [hanja_dict.zip](https://github.com/aetherion-nox/korean-web-annotator/releases/download/v1.1.0/hanja_dict.zip) からダウンロードできます。**先に解凍**して `hanja_dict.db` を取り出し、「エンジン / API 設定」で DB ファイルを選んで辞書を取り込んでください。変換は不要です。この ZIP は公式 JSON ZIP ではないため、そのまま取り込まないでください。

韓国国立国語院『韓国語基礎辞典』の 2026-09-19 公式データから変換した非公式配布版です。テキストデータは [CC BY-SA 2.0 KR](https://creativecommons.org/licenses/by-sa/2.0/kr/) で配布します。画像・音声へのリンクは、それらのメディアに同じライセンスを付与するものではありません。

[韓国語基礎辞典の公式サイト](https://krdict.korean.go.kr/download/downloadPopup) から JSON ZIP をダウンロードし、解凍せずに直接取り込む方法も利用できます。

スマートフォンでの取り込みが遅い場合は、パソコンで先に DB に変換できます。

```sh
python python/backend/upstream/scripts/import_dictionary.py "path/to/dictionary.zip"
```

生成された `python/backend/upstream/hanja_dict.db` をスマートフォンに転送し、同じ設定ページで取り込みます。

## 使い方

- 韓国語のページを開き、拡張機能、ツールバー、右クリックメニューからページ全体の注釈を開始します。
- テキストを選択すると、選択範囲の注釈や再注釈ができます。「取り消し」や「復元」で注釈を削除できます。
- コピー方法は、表示中の本文、本文と注釈、元の韓国語（既定）、注釈のみから選べます。
- OpenAI と Claude に対応し、2026-10-12 の公式ドキュメントで確認した最新モデルを収録しています。思考の切り替えと強度はモデルの対応範囲に合わせて表示されます。
- **モデル審査**：通常の注釈でローカルアルゴリズムが解決できない曖昧さを、モデルで判断します。サービス、モデル、API キーを設定し、審査を有効にしてください。
- **モデルによる再注釈（選択範囲の再審査）**：選択したテキストをモデルに再判断させます。こちらもモデル API の設定が必要ですが、「審査」を有効にする必要はありません。
- ローカル処理のみならモデル API は不要です。

## 謝辞

- [Arrow36 / Hangul-Hanja-mixed-script](https://github.com/Arrow36/Hangul-Hanja-mixed-script)：本拡張機能は、このプロジェクトの韓国語漢字変換と辞書処理コードを直接利用・改変しています。オープンソースでの公開に感謝します。
- [Furiganator（Chrome ウェブストア）](https://chromewebstore.google.com/detail/furiganator/ijfcmmkkmogaclaafpgcjdfcfibmhcfa)：日本語のウェブページにふりがなを付ける拡張機能です。本拡張機能の注釈表示と文字選択方式の参考にしました。
- ツールと辞書資源を提供する Kiwi、Pyodide、韓国国立国語院に感謝します。
