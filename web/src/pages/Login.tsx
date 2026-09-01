import { useState, type FormEvent } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";

export default function Login() {
  const { session, loading, signIn } = useAuth();
  const navigate = useNavigate();

  // 入力欄の状態。React では入力値も「状態」として持つ。
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // すでにログイン済みならホームへ
  if (!loading && session) return <Navigate to="/" replace />;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    const { error } = await signIn(email.trim(), password);
    setSubmitting(false);

    if (error) {
      setError(error); // 失敗：画面遷移させずエラー表示
      return;
    }
    navigate("/", { replace: true }); // 成功時だけ遷移
  }

  return (
    <div className="login-wrap">
      <div className="card login-box">
        <h1>物件通知管理システム</h1>
        <p className="muted">許可された担当者のみログインできます。</p>

        <form onSubmit={handleSubmit} style={{ marginTop: 20 }}>
          <div className="field">
            <label htmlFor="email">メールアドレス</label>
            <input
              id="email"
              type="email"
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          <div className="field">
            <label htmlFor="password">パスワード</label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>
          <button
            type="submit"
            className="btn"
            style={{ width: "100%" }}
            disabled={submitting}
          >
            {submitting ? "確認中…" : "ログイン"}
          </button>
          {error && <p className="error show">{error}</p>}
        </form>
      </div>
    </div>
  );
}
