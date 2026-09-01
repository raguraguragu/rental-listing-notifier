import { Link } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { HomeIcon } from "./icons";

// 全画面共通のヘッダー。
// 左上はアプリ名＝ホームへのリンク（クリックでメニューに戻る）。
// その右に現在のページ名、右端にログイン中メールとログアウト。
export function TopBar({ title }: { title?: string }) {
  const { session, signOut } = useAuth();

  return (
    <header className="topbar">
      <div className="topbar-left">
        <Link to="/" className="home-link">
          <HomeIcon size={18} />
          物件通知管理システム
        </Link>
        {title && <span className="page-title">{title}</span>}
      </div>
      <div className="topbar-right">
        <span className="user">{session?.user.email}</span>
        <button className="btn btn-ghost btn-sm" onClick={signOut}>
          ログアウト
        </button>
      </div>
    </header>
  );
}
