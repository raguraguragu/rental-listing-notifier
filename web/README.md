# LINEユーザー管理画面（React + TypeScript + Vite）

公式LINEに友だち登録したお客様の **LINEユーザーID・表示名** を、担当者（非エンジニア）が
安全に確認するためのWeb画面です。ログインした許可ユーザーだけが閲覧できます。

## 技術構成

| 技術 | 役割 |
|---|---|
| **React + TypeScript** | 画面を「コンポーネント」で組み立てる |
| **Vite** | 開発サーバー＋ビルド（ソース → 配信用の `dist/` を生成） |
| **React Router** | ログイン / ホーム / 一覧 / マニュアルの画面切り替え |
| **@supabase/supabase-js** | Supabase への接続（認証・データ取得） |
| **Cloudflare Pages** | ビルド成果物の配信（Git連携で自動ビルド） |

バックエンド（Supabaseの認証・RLS・データ）は従来と同じものを流用しています。

## ディレクトリ構成

```
web/
├── index.html              入口（ここに React が描画される）
├── package.json            依存パッケージとスクリプト
├── tsconfig.json           TypeScript設定
├── vite.config.ts          Vite設定
├── .env                    接続情報（gitignore。ローカル開発用）
├── .env.example            接続情報のひな形（コミットされる）
├── public/_redirects       SPA用フォールバック（直リンク・再読込対策）
└── src/
    ├── main.tsx            起動
    ├── App.tsx             ルーティング定義
    ├── index.css           共通スタイル
    ├── vite-env.d.ts       環境変数の型
    ├── lib/supabase.ts     Supabaseクライアント（共通）
    ├── auth/
    │   ├── AuthContext.tsx ログイン状態の共有・signIn/signOut
    │   └── RequireAuth.tsx ログイン必須ガード
    ├── components/
    │   └── TopBar.tsx      共通ヘッダー
    └── pages/
        ├── Login.tsx
        ├── Home.tsx
        ├── Users.tsx       LINEユーザー一覧（検索・コピー）
        └── Manual.tsx      操作マニュアル
```

---

## ローカル開発

```bash
cd web
npm install              # 最初の1回（依存パッケージをDL）
cp .env.example .env     # 接続情報を用意（すでに .env がある場合は不要）
npm run dev              # http://localhost:5173 で起動。保存すると即反映
```

`.env` には次の2つを記入します（Supabase ダッシュボード → Project Settings → API）。

```text
VITE_SUPABASE_URL=https://<project-ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<anon キー>
```

ビルドの確認だけしたいときは：

```bash
npm run build            # 型チェック + dist/ を生成
npm run preview          # 生成物をローカルで配信して確認
```

---

## Supabase 側の準備（初回のみ・従来と同じ）

1. SQL Editor で [`../supabase/web-access.sql`](../supabase/web-access.sql) を実行（RLSポリシー）。
2. Authentication → Providers で **新規登録を OFF**（招待制）。
3. Authentication → Users → Add user で担当者アカウントを作成。

> これらは静的HTML版のときに実施済みなら、そのまま使えます（作り直し不要）。

---

## Cloudflare Pages へのデプロイ（Git連携・自動ビルド）

GitHub に push するたびに、Cloudflare が自動で `npm run build` して公開します。

### 初回設定

1. `web/` を含めて GitHub に push しておく。
2. Cloudflare ダッシュボード → **Workers & Pages → Create → Pages → Connect to Git**。
3. このリポジトリを選択。
4. ビルド設定：

   | 項目 | 値 |
   |---|---|
   | Production branch | `main` |
   | Framework preset | `Vite` |
   | Build command | `npm run build` |
   | Build output directory | `dist` |
   | **Root directory**（詳細設定） | `web` |

5. **Environment variables（Build）** に次の2つを登録：

   ```text
   VITE_SUPABASE_URL        = https://<project-ref>.supabase.co
   VITE_SUPABASE_ANON_KEY   = <anon キー>
   ```

   > `.env` は gitignore されているため、Cloudflare 側のビルドではこの環境変数が使われます。
   > ローカル開発では `web/.env` が使われます。

6. **Save and Deploy**。以降は `main` への push で自動再ビルド・再公開されます。

### 既存の「直接アップロード」プロジェクトについて

以前 `wrangler pages deploy` で作った `line-user-admin` は「直接アップロード型」で、
後から Git 連携には変更できません。次のどちらかにします。

- **同じURLを使いたい**: 旧プロジェクトを削除（Pages → 該当プロジェクト → Settings → Delete project）してから、
  上記手順で同名の Git 連携プロジェクトを作り直す。
- **別URLでよい**: 新しい名前で Git 連携プロジェクトを作る（旧プロジェクトは放置でも害はない）。

---

## セキュリティ（従来どおり）

- 全画面ログイン必須。`RequireAuth` が未ログインを `/login` へ送り返す（画面側ガード）。
- 万一すり抜けても、RLS により未ログインでは `line_users` は0件しか返らない（最後の砦）。
- `VITE_SUPABASE_ANON_KEY` は公開してよい鍵（RLSで保護）。service_role キーは絶対に置かない。
