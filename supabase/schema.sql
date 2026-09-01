-- ============================================================
-- Rental Listing Notifier - Supabase スキーマ
-- ============================================================
-- 実行方法: Supabase ダッシュボード → SQL Editor → このファイルを貼り付けて Run

-- ============================================================
-- 1. 通知済み物件テーブル
--    同一物件を重複通知しないための履歴
-- ============================================================
create table if not exists notified_properties (
  id                   uuid primary key default gen_random_uuid(),
  -- LINEのユーザID（通知を送った相手）
  line_user_id         text not null,
  -- 建物名・部屋番号・住所・階数・間取り・面積から生成したハッシュ
  property_fingerprint text not null,
  -- 初回通知時の物件情報スナップショット（JSONB）
  first_listing        jsonb not null,
  created_at           timestamptz not null default now(),
  -- 同一ユーザー×同一物件の重複登録を防ぐ
  unique (line_user_id, property_fingerprint)
);

-- ============================================================
-- 2. 通知ログテーブル
--    送信成功・失敗をすべて記録する
-- ============================================================
create table if not exists notification_logs (
  id                   uuid primary key default gen_random_uuid(),
  -- LINEのユーザID（通知を送った相手）
  line_user_id         text not null,
  property_fingerprint text not null,
  -- 'sent' | 'failed'
  status               text not null check (status in ('sent', 'failed')),
  -- 送信したメッセージ本文（sent の場合）
  message              text,
  -- エラーメッセージ（failed の場合）
  error                text,
  created_at           timestamptz not null default now()
);

-- ============================================================
-- 3. LINE ユーザーテーブル
--    Webhook経由で取得したLINEのuserId・表示名を保存する
--    担当者がWeb管理画面（Cloudflare Pages）でこれを見てATBB顧客と照合する
-- ============================================================
create table if not exists line_users (
  id           uuid primary key default gen_random_uuid(),
  user_id      text not null unique,
  display_name text not null,
  -- 友達追加・メッセージ送信など
  event_type   text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- ============================================================
-- インデックス
-- ============================================================
create index if not exists idx_notified_properties_user
  on notified_properties (line_user_id);

create index if not exists idx_notification_logs_user
  on notification_logs (line_user_id, created_at desc);

-- ============================================================
-- updated_at 自動更新トリガー
-- ============================================================
create or replace function update_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace trigger trg_line_users_updated_at
  before update on line_users
  for each row execute function update_updated_at();

-- ============================================================
-- Row Level Security（RLS）
--    service_role キーからのアクセスはRLSをバイパスするため、
--    GitHub Actions や Edge Function はすべて service_role を使う。
--    Web管理画面（Cloudflare Pages）はブラウザからanonキーで接続し、
--    line_users の閲覧ポリシーは supabase/web-access.sql で定義する。
-- ============================================================
alter table notified_properties        enable row level security;
alter table notification_logs          enable row level security;
alter table line_users                 enable row level security;
