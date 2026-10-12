# 韓国語ウェブ注釈ツール

[简体中文](README.md) · [English](README.en.md) · **日本語** · [한국어](README.ko.md)

漢字語は本文に漢字、その上に元のハングルを表示します。外来語は韓国語を残し、その上に原語を表示します。辞書を取り込めばローカル処理が可能で、サーバーやモデル API は不要です。

## インストールと更新

1. [Release](https://github.com/aetherion-nox/korean-web-annotator/releases/tag/v1.1.0) の **Assets** から `Korean-Web-Annotator-v1.1.0.zip` をダウンロードして解凍します。
2. Chrome の `chrome://extensions` でデベロッパーモードを有効にし、「パッケージ化されていない拡張機能を読み込む」から `manifest.json` があるフォルダーを選択します。スマートフォンでは Quetta の拡張機能読み込みを利用します。
3. 更新時はファイルを置き換え、拡張機能とウェブページを再読み込みします。

Release の完全なインストールパッケージを使用してください。Python は不要です。

## 辞書の取り込み

1. 同じ Release の **Assets** から [hanja_dict.zip](https://github.com/aetherion-nox/korean-web-annotator/releases/download/v1.1.0/hanja_dict.zip) をダウンロードします。
2. **先に解凍**して `hanja_dict.db` を取り出します。
3. 「エンジン / API 設定」で DB ファイルを選択して取り込みます。

[韓国語基礎辞典の公式サイト](https://krdict.korean.go.kr/download/downloadPopup)から公式 JSON ZIP を入手し、解凍せず直接取り込む方法も利用できます。どちらか一方で十分です。

## 使い方

- 拡張機能、ページのツールバー、右クリックメニューからページ全体を処理できます。文字を選択して選択範囲だけを処理することもできます。
- 「取り消し」は直前の注釈を取り消し、「復元」は原文に戻します。
- コピー方法は、表示中の本文、本文と注釈、元の韓国語（既定）、注釈のみから選べます。
- 「キャッシュを無視してテキストを再解析」で文字を再処理できます。

## モデル API（任意）

次のサービスとモデルを設定画面で選択できます。

| サービス | モデル |
| --- | --- |
| OpenAI | GPT-6.1 Sol / GPT-6 Astra / GPT-6 Luna |
| Claude (Anthropic) | Sonnet 5.5 / Opus 5.5 / Haiku 5.5 / Fable 5.1 |
| GLM (Z.AI) | GLM-5.3 / GLM-5.3-Flash / GLM-5.3-FlashX |
| Xiaomi MiMo | MiMo-V2.6-Flash / V2.6-Pro / V2.6-Pro-Ultraspeed / V2.5 / V2.5-Pro |
| DeepSeek | deepseek-flash / deepseek-v4-pro |
| カスタム | OpenAI Chat Completions 互換の URL、モデル名、API キーを手動入力 |

サービスとモデルを選択し、API キーを入力して保存した後、「API テスト」で確認します。思考の切り替えと強度はモデルの対応範囲に合わせて表示されます。カスタムモデルはサーバーの既定値を使用します。互換サービスには通常 `/chat/completions` で終わる完全な URL を入力してください。

- **モデル審査**：通常の注釈処理でローカル処理が解決できない曖昧さを判断します。
- **選択範囲のモデル再審査**：選択した文字をモデルに再判断させます。API は必要ですが、通常の審査スイッチは無効のままでも利用できます。

## 謝辞と辞書の出典

- [Arrow36 / Hangul-Hanja-mixed-script](https://github.com/Arrow36/Hangul-Hanja-mixed-script)：韓国語漢字変換と辞書処理コードを直接利用・改変しています。
- [Furiganator（Chrome ウェブストア）](https://chromewebstore.google.com/detail/furiganator/ijfcmmkkmogaclaafpgcjdfcfibmhcfa)：日本語ページにふりがなを付ける拡張機能です。注釈表示と文字選択方式を参考にしました。
- Kiwi、Pyodide、韓国国立国語院に感謝します。

DB は国立国語院『韓国語基礎辞典』2026-09-19 の公式データを変換した非公式版です。テキストデータは [CC BY-SA 2.0 KR](https://creativecommons.org/licenses/by-sa/2.0/kr/) で配布します。リンク先のメディアには別の許諾条件が適用されます。
