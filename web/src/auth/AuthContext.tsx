import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "../lib/supabase";

// アプリ全体でログイン状態を共有するための「コンテキスト」。
// どの画面からでも useAuth() で現在のログイン状態を取得できる。
type AuthContextValue = {
  session: Session | null; // ログイン中ならセッション、未ログインなら null
  loading: boolean; // 起動直後の判定中は true
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  // 起動時に一度だけ実行：現在のセッションを取得し、以後の変化も監視する。
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });

    // ログイン・ログアウトが起きたら session を更新する購読
    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    // 失敗の詳細はユーザーに見せず、共通メッセージにする
    return { error: error ? "メールアドレスまたはパスワードが違います。" : null };
  };

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  return (
    <AuthContext.Provider value={{ session, loading, signIn, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

// 各画面から「ログイン状態」を使うためのショートカット
export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth は AuthProvider の中で使ってください");
  return ctx;
}
