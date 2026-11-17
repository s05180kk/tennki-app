# 気象予報士 一問一答アプリ

気象予報士試験（学科一般・学科専門）の過去問PDFから問題を取り出して、ブラウザで使う一問一答アプリにします。

- **○× 一問一答**：正誤問題の各文 (a)〜(d) を1文ずつ出題します。正誤は公式解答例の正解番号から自動で割り出します。
- **五択 過去問**：本番と同じ形式で1問ずつ出題します。
- 学習記録（正答率・苦手）はブラウザに保存し、Cloudflare 上で使うときは端末間で同期します。

> 試験問題は無断転載が禁止されているため、このリポジトリには問題PDFも、そこから生成した `data.js` も含めていません。
> 問題データは手元のPDFから生成し、Cloudflare の KV に直接アップロードします。

## 構成

| パス | 内容 |
| --- | --- |
| `app/public/index.html` | アプリ本体（1ファイル） |
| `app/src/index.ts` | Cloudflare Worker：Access の認証、問題データの配信、学習記録の同期API |
| `app/cloudflare.config.ts` | Worker の設定（`cf` CLI 用） |
| `tools/` | 過去問PDF → `data.js` の生成と、KV へのアップロード |

### Worker の動き

- すべてのリクエストで Cloudflare Access の JWT（署名・aud・iss・有効期限）を検証し、通らなければ 403 を返します。
- Access の設定が KV に無いあいだは、すべて 403 になります（フェイルクローズ）。
- KV のキー：
  - `config:access`：Access 検証の設定 `{"teamDomain": "<チーム名>.cloudflareaccess.com", "aud": "<AUD タグ>"}`
  - `data:data.js`：問題データ
  - `stats:<メールアドレス>`：ユーザーごとの学習記録

## 問題データの作成とアップロード（Windows）

1. 過去問PDFを次の構成で置きます。

   ```
   気象予報士試験_過去問/
     第66回_2026年8月/
       01_学科一般問題.pdf
       02_学科専門問題.pdf
       ..._学科・実技解答例.pdf
   ```

2. データを生成して KV にアップロードします。Windows 標準の游ゴシックなどのフォントを使って文字化けを直すため、Windows で実行してください。`cf auth login` が必要です。

   ```
   cd tools
   npm install
   npm run build    # app/public/data.js を生成
   npm run upload   # KV の data:data.js にアップロード
   ```

`app/public/index.html` をPCで直接開けば、オフラインでも使えます（このときは原本PDFへのリンクも出ます）。

## デプロイ

GitHub に push すると、Cloudflare Workers Builds がビルドしてデプロイします。

| 項目 | 値 |
| --- | --- |
| ルートディレクトリ | `app` |
| ビルドコマンド | （空欄） |
| デプロイコマンド | `npx cf deploy` |
