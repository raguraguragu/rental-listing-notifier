import { Link } from "react-router-dom";
import { TopBar } from "../components/TopBar";
import { ListIcon, BookIcon } from "../components/icons";

export default function Home() {
  return (
    <>
      <TopBar />
      <main className="container">
        <p className="muted" style={{ marginTop: 0 }}>
          使いたいメニューを選んでください。
        </p>
        <nav className="menu">
          <Link to="/users">
            <div className="icon">
              <ListIcon size={28} />
            </div>
            <div className="title">LINEユーザー一覧</div>
            <div className="desc">表示名からLINEユーザーIDを探してコピーします。</div>
          </Link>
          <Link to="/manual">
            <div className="icon">
              <BookIcon size={28} />
            </div>
            <div className="title">操作マニュアル</div>
            <div className="desc">この画面の使い方とATBB登録の手順です。</div>
          </Link>
        </nav>
      </main>
    </>
  );
}
