# Rental Listing Notifier
ATBBに登録した顧客条件を定期確認し、新しい物件だけをLINE Messaging API（公式）経由で顧客のLINEアカウントへ直接通知するシステムです。
# 要件

顧客は、公式LINEで管理します。
顧客とのやり取りは、公式LINEです。
atbbという賃貸業者向けサイトを使っています。

zoomなどで顧客の条件をヒアリングして、atbbに登録します。ここまでは、手動で実施します。

atbbに登録するとき、顧客のLINEのアカウントと、atbbを紐づけする必要があります。

atbbに登録したあと、条件にある物件が追加されたりすると、lineでお客様に通知します。

1時間に1回atbbにアクセスして、新しい物件が追加されていないか確認して、もし追加されていたら、LINEでお客様に通知します。

ただし、家賃や管理費などが変わっても同一物件だった場合は、通知しません。

運用は、無料で実施します。

すでに完全手動による運用が行われています。
なので、公式LINEにある程度の顧客のアカウントが登録されていて、メッセージのやり取りも行われています。


LINEの画面では、ユーザIDは特定できません。
       ↓
② 担当者が友達リストAPIで全userIdを取得
   → プロフィールAPIで表示名を確認
   → 顧客の名前と照合してuserIdを特定
       ↓
③ SupabaseのATBB顧客条件レコードにuserIdを保存
# 設計方針
定期実行は [cron-job.org](https://cron-job.org) から GitHub Actions を起動する設定（GitHub Actions の `schedule` は使わない）
atbbには、Playwrightを使ってATBBログインをして物件の情報などを取得する
atbbと顧客との紐づけは、LINEのユーザIDを使用する。
atbbに登録するときに、LINEのユーザIDを必ず入力する運用とする。
LINEのユーザIDは、何らかのWeb画面で見れるようにする。
担当者は、非エンジニアです。DBのテーブルをそのまま見てもらうのではなく、ある程度見やすい画面にする必要があります。
LINEのユーザIDや表示名は、個人情報なので、誰でも見える状態にはしてはいけません。
LINEのユーザIDは、Webhookを利用する。ただし、L Message（エルメ）がWebhookを利用しているので、Webhookのプロキシを使います。


Supabaseでデータを管理します。



LINEのユーザIDを確認するWeb画面は、Cloudflare Pages（無料・商用利用可）で配信する静的ページとして作成します。顧客情報は、個人情報なので、特定の人しか見れないようにします。

メールアドレス+パスワードでログインできるようにします（Supabase Auth）。ログインした担当者だけが画面を閲覧でき、未ログインではデータは表示されません。詳しくは [web/README.md](web/README.md) を参照してください。




#fetch https://github.com/line/line-developers-docs-source/blob/main/docs/ja/reference/messaging-api/index.html.md

がLINEのAPIの仕様です。

LINE Message APIでメッセージを送ります。



## いま実装済みの範囲

- cron-job.org から GitHub Actions を起動する定期実行設定（GitHub Actions の `schedule` は使わず、`workflow_dispatch` を外部から叩く）
- Supabaseに顧客条件、通知済み物件、通知ログを保存するスキーマ
- 家賃や管理費が変わっても同一物件として扱う重複判定
- 管理会社情報をLINE通知文に含めないメッセージ生成
- LINE Messaging API（公式）で顧客のLINEアカウントへ直接送信するクライアント
- PlaywrightによるATBBログインと物件一覧取得
- Supabase Edge FunctionによるLINE WebhookプロキシとuserId自動保存
- 担当者向けWeb管理画面（`web/`）。Cloudflare Pages配信＋Supabase Authログイン＋RLSで、許可ユーザーだけがLINEユーザーID一覧とマニュアルを閲覧できる

ATBBの画面構造は環境によって変わる可能性があるため、ログインフォームと一覧のCSSセレクタはGitHub Repository Variablesで指定します。

ATBBは公開APIがない前提のため、Playwrightでブラウザを自動操作します。利用規約や社内ルールで自動ログイン・自動取得が許可されているか確認してから本番運用してください。

認証情報はチャット、README、コード、Issue、Pull Requestに書かず、GitHub Secretsにだけ保存します。認証情報をチャット等に貼った場合は、ATBB側でパスワードを変更してからSecretsへ登録してください。

## 必要な外部サービス

- GitHub Actions
- cron-job.org（定期実行のトリガー、無料）
- Supabase Free
- Cloudflare Pages（Web管理画面の配信。無料・商用利用可）
- ATBBアカウント
- LINE公式アカウント（Messaging API チャネル。物件通知の送信先）
- エルメ（任意。既存の手動運用を続ける場合のみ、WebhookプロキシからLINEイベントを転送する先）

## 初期セットアップ

1. Supabaseで新規プロジェクトを作成します。
2. Supabase SQL Editorで [supabase/schema.sql](supabase/schema.sql) を実行します。
3. ATBBの保存条件名を `{LINEユーザーID}_{名前}` 形式で登録します（そのLINEユーザーIDが `line_users` に存在するものが通知対象）。
4. GitHub Repository Secretsに次を登録します。

```text
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
ATBB_USERNAME
ATBB_PASSWORD
LINE_CHANNEL_ACCESS_TOKEN
```

5. GitHub Repository Variablesに次を登録します。

```text
ATBB_SOURCE_MODE=fixture
```

ATBB実取得を使う場合は、さらに次のVariablesを設定します。

```text
ATBB_USERNAME_SELECTOR
ATBB_PASSWORD_SELECTOR
ATBB_SUBMIT_SELECTOR
ATBB_LISTING_ROW_SELECTOR
ATBB_LISTING_NAME_SELECTOR
ATBB_LISTING_ADDRESS_SELECTOR
ATBB_LISTING_ROOM_SELECTOR
ATBB_LISTING_FLOOR_SELECTOR
ATBB_LISTING_LAYOUT_SELECTOR
ATBB_LISTING_AREA_SELECTOR
ATBB_LISTING_RENT_SELECTOR
ATBB_LISTING_DETAIL_URL_SELECTOR
```

6. Actionsの `Check rental listings` を手動実行します。

## 定期実行（cron-job.org から GitHub Actions を起動）

定期実行は GitHub Actions の `schedule` ではなく、[cron-job.org](https://cron-job.org)（無料）から GitHub Actions の `workflow_dispatch` を叩いて起動します。GitHub Actions 側のワークフローは `workflow_dispatch` のみで、自動スケジュールは持ちません。

### GitHub 側の準備

1. GitHubで [Personal Access Token](https://github.com/settings/tokens) を作成します。
   - Fine-grained token の場合: 対象リポジトリに対して **Actions: Read and write** 権限を付与します。
   - Classic token の場合: `repo` スコープ（または `workflow`）を付与します。
2. トークンは漏れると誰でもワークフローを起動できるため、安全に保管します（チャットやコードに貼らない）。

### cron-job.org 側の設定

1. cron-job.org にログインし、新しいジョブ（Cronjob）を作成します。
2. **URL** に次を設定します（`OWNER`・`REPO` は自分のリポジトリに置き換え）。

   ```text
   https://api.github.com/repos/OWNER/REPO/actions/workflows/check-listings.yml/dispatches
   ```

3. **Request method** を `POST` にします。
4. **Headers** に次を追加します。

   ```text
   Accept: application/vnd.github+json
   Authorization: Bearer <作成したトークン>
   X-GitHub-Api-Version: 2022-11-28
   ```

5. **Request body** に次を設定します（`main` は対象ブランチ）。

   ```json
   {"ref":"main"}
   ```

6. 成功すると GitHub は HTTP 204 を返します。Actions の `Check rental listings` が起動することを確認します。

### 実行間隔・実行時間帯

実行間隔と稼働時間帯は cron-job.org のスケジュール設定で指定します。GitHub Actions 側には `schedule` を持たせないため、ここが唯一の定期実行トリガーになります。

現在の設定は次のとおりです。

- タイムゾーン: `Asia/Tokyo`
- **8時〜22時の毎時1回**だけ実行（23時〜翌7時は実行しない）

深夜の時間帯は cron-job.org が GitHub Actions を起動しないため、その間は物件チェックも通知も発生しません。深夜に通知したくない場合は、このように cron-job.org 側で稼働時間帯（Hours）を絞るのが一番シンプルで確実です（アプリ側のコードで時刻判定して止める方法もありますが、その場合は「起動はするが通知だけしない」動きになり GitHub Actions の実行時間は消費します）。

稼働時間帯を変更する場合は、cron-job.org のジョブ設定で **Schedule** を開き、タイムゾーンを `Asia/Tokyo` にしたうえで **Hours（時）** のチェックを調整します。

## LINE Webhook プロキシ（Supabase Edge Function）

LINEのWebhookを受信してuserIdをSupabaseに保存しつつ、エルメへ転送します。

### デプロイ手順

1. [Supabase CLI](https://supabase.com/docs/guides/cli) をインストールします。

```bash
# Windows (winget)
winget install Supabase.CLI
# または npm
npm install -g supabase
```

2. Supabaseプロジェクトにログインしてリンクします。

```bash
supabase login
supabase link --project-ref <SUPABASE_PROJECT_REF>
```

`SUPABASE_PROJECT_REF` は Supabase ダッシュボード → Project Settings → General → **Reference ID** で確認します。

3. Edge Function に必要なシークレットを登録します。

```bash
supabase secrets set LINE_CHANNEL_SECRET=<値>
supabase secrets set LINE_CHANNEL_ACCESS_TOKEN=<値>
supabase secrets set ELME_WEBHOOK_URL=<エルメのWebhook URL>
```

4. Edge Function をデプロイします。

```bash
supabase functions deploy webhook-proxy --no-verify-jwt
```

5. デプロイ後に表示されるURLを確認します（形式は `https://<project-ref>.supabase.co/functions/v1/webhook-proxy`）。

6. LINE Developers Console → Messaging API設定 → **Webhook URL** にそのURLを設定します。

7. Webhookの疎通確認（**検証**ボタン）を実行します。Supabase ダッシュボード → Edge Functions → Logs でリクエストが届いたことを確認します。

8. スマホのLINEで公式アカウントにメッセージを送り、Supabaseの `line_users` テーブルにレコードが登録されることを確認します。

## ATBBからデータを取得する方法

GitHub Actions上でPlaywrightを使って、ATBBのログイン画面と検索結果画面を操作します。

1. `ATBB_USERNAME` と `ATBB_PASSWORD` SecretにATBB認証情報を登録します。
3. ATBBへ手動ログインし、保存条件を `{LINEユーザーID}_{名前}` 形式の条件名で登録します。
4. そのLINEユーザーIDが Supabase の `line_users` テーブルに登録されていれば通知対象になります。
5. ブラウザの開発者ツールでログイン欄・物件一覧のCSSセレクタを確認し、Repository Variablesに登録します。
6. まず `DRY_RUN=true`、`ATBB_SOURCE_MODE=browser` でGitHub Actionsを手動実行します。
7. ログとSupabaseを確認し、問題なければ `DRY_RUN=false` に切り替えます。

ログイン後にワンタイム認証や画像認証が出る場合、GitHub Actionsでの自動実行は安定しません。その場合は、ATBB側のメール通知・CSV出力・保存条件通知など別の入口がないか確認してください。

## ローカル実行

```bash
npm install
cp .env.example .env
npm run check
npm start
```

`.env` に本番の認証情報を書いた場合でも、`.env` はGit管理しません。

## 同一物件の判定

次の情報からハッシュを作ります。

- 建物名
- 所在地
- 間取り
- 専有面積

部屋番号と階数は同一判定に使いません。号室や階が違っても、間取りと専有面積が同じであれば同一物件とみなし、重複通知を避けるためです。

家賃、管理費、管理会社情報も同一判定に使いません。家賃変更や管理会社側の修正で同じ物件が再通知されるのを避けるためです。

### 重複の挙動

- **同一実行内に同じ物件が複数あった場合**（例: マンションA 1K 204号室 と 205号室）、一覧で先に出てきた1件だけを送信します（通常は号室の若い方）。残りはスキップします。
- **過去に通知済みの物件**は、号室・階・家賃が違っても、建物名・所在地・間取り・専有面積が同じであれば再通知しません（例: 204号室を通知済みなら、後から出た 305号室も通知しない）。
- 逆に、**専有面積や間取りが違えば別物件**として通知します。同じ「1K」でも専有面積が異なれば別物件です。
- 判定を分けるのは家賃ではなく専有面積です。家賃が違っても専有面積などが同じなら同一物件、家賃が同じでも専有面積が違えば別物件です。

### 判定ルールを変更した場合のマイグレーション

判定ルール（ハッシュ対象）を変えると、既存レコードの指紋がすべて変わるため、ルール変更後の初回実行で過去通知済みの物件が「未通知」と誤判定され再通知される恐れがあります。これを防ぐため、`notified_properties` の指紋を `first_listing`（保存済み物件スナップショット）から再計算するスクリプトを用意しています。

```bash
# まずドライランで変更内容を確認（DBは変更しない）
npm run db:recompute

# 問題なければ適用（重複レコードは最古の1件を残して削除し、指紋を更新）
npm run db:recompute -- --apply
```