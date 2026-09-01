import { useEffect, useMemo, useState } from "react";
import { TopBar } from "../components/TopBar";
import { supabase } from "../lib/supabase";
import { RefreshIcon, CopyIcon, CheckIcon, SearchIcon } from "../components/icons";

// line_users テーブル1行分の型。
type LineUser = {
  display_name: string;
  user_id: string;
  // 相手からメッセージ・ボタン操作・友だち追加などを受信した最終日時。同名ユーザーの判別に使う。
  updated_at: string;
};

type Status = "loading" | "ready" | "error";

export default function Users() {
  const [users, setUsers] = useState<LineUser[]>([]);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<Status>("loading");
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Supabase から全件取得する。検索はブラウザ側で絞り込むので通信は最初の1回だけ。
  async function load() {
    setStatus("loading");
    const { data, error } = await supabase
      .from("line_users")
      .select("display_name, user_id, updated_at")
      .order("updated_at", { ascending: false });

    if (error) {
      setStatus("error");
      return;
    }
    setUsers((data as LineUser[]) ?? []);
    setStatus("ready");
  }

  // 画面を開いたとき一度だけ読み込む
  useEffect(() => {
    load();
  }, []);

  // 検索ボックスの入力で絞り込んだ一覧（再計算をキャッシュ）
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return users;
    return users.filter((u) => u.display_name.toLowerCase().includes(q));
  }, [users, query]);

  async function copy(id: string) {
    await navigator.clipboard.writeText(id);
    setCopiedId(id);
    setTimeout(() => setCopiedId((cur) => (cur === id ? null : cur)), 1200);
  }

  function formatDate(iso: string) {
    return new Date(iso).toLocaleString("ja-JP", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  return (
    <>
      <TopBar title="LINEユーザー一覧" />
      <main className="container">
        <div className="card">
          <div className="toolbar">
            <div className="search-box">
              <SearchIcon size={16} />
              <input
                type="search"
                placeholder="表示名で検索（例: 山田）"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
            <button className="btn btn-ghost" onClick={load}>
              <RefreshIcon size={16} />
              更新
            </button>
            <span className="muted">
              {status === "ready" ? `${filtered.length} 件` : ""}
            </span>
          </div>

          <div className="list-note">
            「メッセージ・アクションを受信した最終日時」は、お客様から次の操作があったときに更新されます。
            <ul>
              <li>メッセージ（テキスト・画像・スタンプなど）を送信したとき</li>
              <li>友だち追加・ブロック解除をしたとき</li>
              <li>ブロックをしたとき</li>
              <li>ボタンなどのアクションをタップしたとき</li>
              <li>動画を最後まで視聴したとき</li>
              <li>送信を取り消したとき</li>
              <li>ビーコン受信・アカウント連携・メンバーシップの操作をしたとき</li>
            </ul>
            <div className="list-note-warn">
              ※ こちらから（公式アカウントから）メッセージを送信しても、この日時は更新されません。
            </div>
          </div>

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>表示名</th>
                  <th>LINEユーザーID</th>
                  <th>メッセージ・アクションを受信した最終日時</th>
                </tr>
              </thead>
              <tbody>
                {status === "loading" && (
                  <tr>
                    <td colSpan={3} className="muted">
                      読み込み中…
                    </td>
                  </tr>
                )}
                {status === "error" && (
                  <tr>
                    <td colSpan={3} className="error show">
                      読み込みに失敗しました。「更新」を押してください。
                    </td>
                  </tr>
                )}
                {status === "ready" && filtered.length === 0 && (
                  <tr>
                    <td colSpan={3} className="muted">
                      該当するユーザーがいません。
                    </td>
                  </tr>
                )}
                {status === "ready" &&
                  filtered.map((u) => (
                    <tr key={u.user_id}>
                      <td>{u.display_name}</td>
                      <td className="userid">
                        {u.user_id}
                        <button
                          className="btn btn-ghost btn-sm"
                          style={{ marginLeft: 8 }}
                          onClick={() => copy(u.user_id)}
                        >
                          {copiedId === u.user_id ? (
                            <>
                              <CheckIcon size={14} />
                              コピー済み
                            </>
                          ) : (
                            <>
                              <CopyIcon size={14} />
                              コピー
                            </>
                          )}
                        </button>
                      </td>
                      <td>{formatDate(u.updated_at)}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>
      </main>
    </>
  );
}
