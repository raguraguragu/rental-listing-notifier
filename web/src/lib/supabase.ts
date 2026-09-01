import { createClient } from "@supabase/supabase-js";

// Vite はビルド時に import.meta.env.VITE_xxx を実際の値へ置き換える。
// （.env もしくは Cloudflare の環境変数から読み込まれる）
const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  throw new Error(
    "VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY が未設定です。.env（またはCloudflareの環境変数）を確認してください。",
  );
}

// アプリ全体で共有する Supabase クライアント。
// anon キーは公開してよい鍵で、実際のアクセス制御は RLS が担う。
export const supabase = createClient(url, anonKey);
