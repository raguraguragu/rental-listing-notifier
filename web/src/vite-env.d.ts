/// <reference types="vite/client" />

// import.meta.env から読める環境変数の型を宣言しておく。
// これで TypeScript が VITE_SUPABASE_URL などを「文字列」として認識する。
interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_ANON_KEY: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
