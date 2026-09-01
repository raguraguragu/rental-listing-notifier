import { Navigate } from "react-router-dom";
import type { ReactNode } from "react";
import { useAuth } from "./AuthContext";

// ログイン必須ページを包む部品。
// 未ログインなら中身を描画せず、ログイン画面へ送り返す（＝0件表示も起きない）。
export function RequireAuth({ children }: { children: ReactNode }) {
  const { session, loading } = useAuth();

  if (loading) return null; // 判定中は何も表示しない（一瞬のちらつき防止）
  if (!session) return <Navigate to="/login" replace />;
  return <>{children}</>;
}
