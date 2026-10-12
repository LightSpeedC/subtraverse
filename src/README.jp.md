# Subtraverse

[English](README.md) | 日本語

Firefox 用の拡張機能です。いま見ているページを起点に、**指定したURLの配下だけ**をたどってURL一覧を作り、確認してから選んだものを ZIP で一括保存できます。

## できること

- 開始URLからリンクをたどり、取得範囲(URLの前方一致)に入るものだけを一覧化
- 保存前に一覧を確認し、チェックの付け外し、絞り込み、並べ替えが可能
- URL一覧のコピー、テキスト保存
- 選択したURLの内容を、サイト構造を保ったまま ZIP に保存(`_subtraverse_index.tsv` に保存パスとURLの対応を同梱)
- ログイン済みのサイトも、ブラウザのログイン状態のまま取得可能
- Shift_JIS / EUC-JP のページからもリンクを抽出可能

## 動作環境

Firefox 140 以降(デスクトップ版)。

## インストール

### 一時的に読み込む(動作確認向け)

1. Firefox のアドレスバーに `about:debugging#/runtime/this-firefox` を入力して開く
2. 「一時的なアドオンを読み込む」を押す
3. このフォルダの `manifest.json`(または ZIP / xpi)を選ぶ

Firefox を再起動すると外れます。

### 常用する場合

- Mozilla の署名が必要です。Firefox Add-ons ( https://addons.mozilla.org/developers/ ) に「非公開(unlisted)」で提出すると、公開せずに署名済みの `.xpi` を受け取れます。
- Firefox Developer Edition / Nightly / ESR では、`about:config` の `xpinstall.signatures.required` を `false` にすると未署名のまま常用できます。
- 社内配布は、Firefox のエンタープライズポリシー(`ExtensionSettings`)で署名済み `.xpi` を配布するのが確実です。

## 使い方

1. 取得したいサイトのページを開く(例: `https://example.com/docs/index.html`)
2. ツールバーのアイコン、または `Alt+Shift+S` でサイドバーを開く
3. 「現在のタブ」で開始URLを入れる。取得範囲は開始URLのあるフォルダ(`https://example.com/docs/`)が自動で入る
4. 必要なら取得範囲を編集して「一覧を取得」を押す
5. 一覧を確認し、不要なものはチェックを外す
6. 「選択をZIPで保存」(またはURL一覧のコピー / 保存)

### 取得範囲の考え方

取得範囲に指定したURLで**始まる**ものだけが対象です。

| 開始URL | 自動で入る範囲 | 対象になる例 | 対象外の例 |
| --- | --- | --- | --- |
| `https://example.com/docs/index.html` | `https://example.com/docs/` | `https://example.com/docs/a/b.html` | `https://example.com/blog/` |
| `https://example.com/docs/` | `https://example.com/docs/` | `https://example.com/docs/x.pdf` | `https://other.example.com/docs/` |

範囲外へリダイレクトされるURLは、取得せずスキップします。

## 設定

| 項目 | 既定値 | 説明 |
| --- | --- | --- |
| 最大の深さ | 5 | 開始ページから何回リンクをたどるか |
| 最大件数 | 300 | 発見するURLの上限(最大 5000) |
| 取得間隔 | 300 ms | 1リクエストごとの待ち時間(サーバー負荷の抑制) |
| 並列数 | 2 | 同時に取得する数 |
| 付随ファイル | オフ | 画像・CSS・JS を対象にするか |
| 範囲外でも同一サイトの付随ファイルを許可 | オフ | `/static/` など範囲外にある付随ファイルを含めたい場合 |

## 仕様と制限

- **一覧の作成中は、HTML 以外の本体をダウンロードしません。** PDF などは Content-Type とサイズだけを記録し、ZIP の作成時に取得します。HTML は一覧作成時に取得したものを使い回します。
- **JavaScript で描画されるリンクは拾えません。** 取得した HTML の `<a href>` などを解析します。
- **CSS 内の `url()` は辿りません。** CSS から参照される画像やフォントは対象外です。
- **保存したページ内のリンクは書き換えません。** ZIP 内はURLのパス構造を保っているので多くは相対リンクのまま辿れますが、完全なオフラインミラーではありません。
- 末尾が `/` のURLは `index.html`、拡張子のない HTML は `.html` を付けて保存します。クエリ付きURLは `__q` + 短いハッシュを付けて区別します。
- `robots.txt` は確認しません。対象サイトの利用規約を確認し、取得間隔を適切に設定してください。
- Firefox のコンテナタブ内のログイン状態は引き継げません(既定コンテナの Cookie を使います)。

## ファイル構成

```
manifest.json
background.js          クロール処理と ZIP 生成
lib/util.js            URL 正規化・パス変換などの共通関数
lib/jszip.min.js       JSZip 3.10.2
sidebar/               サイドバーの UI
icons/icon.svg
```

## ライセンス

JSZip は MIT または GPL-3.0-or-later のデュアルライセンスです ( https://github.com/Stuk/jszip )。同梱の `lib/jszip.min.js` は、Mozilla のアドオン検証に通すため、`setImmediate` 互換処理内の未使用の `new Function` を1か所だけ削除しています。
