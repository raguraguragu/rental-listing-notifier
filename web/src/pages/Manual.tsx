import { Link } from "react-router-dom";
import { TopBar } from "../components/TopBar";

// マニュアル内のスクリーンショット。
// 画像ファイルは web/public/manual/ に置く（src は /manual/ から始まる）。
function Shot({ src, alt }: { src: string; alt: string }) {
  return (
    <figure className="manual-figure">
      <img src={src} alt={alt} loading="lazy" />
      <figcaption>{alt}</figcaption>
    </figure>
  );
}

export default function Manual() {
  return (
    <>
      <TopBar title="操作マニュアル" />
      <main className="container">
        <div className="card manual">
          <p>
            このマニュアルは、物件が更新されたときに自動的にLINEで通知できるようにするためのマニュアルです。
          </p>

          <h2>1. ATBBで検索条件を作る</h2>
          <ol>
            <li>ATBBにログインします。</li>
            <li>物件の条件を入力して検索します。</li>
          </ol>
          <Shot src="/manual/物件を検索の画面.png" alt="物件を検索する画面" />
          <div className="note">
            「<strong>地図から探す</strong>」ではなく「<strong>所在地/沿線から探す</strong>」を選んでください。
          </div>

          <h2>2. 検索条件を保存する</h2>
          <ol>
            <li>検索したら、その条件を保存します。</li>
            <li>
              保存するときに<strong>タイトル</strong>を入力します。
              このタイトルに<strong>LINEユーザーID</strong>を入れます（付け方は手順4）。
            </li>
          </ol>
          <Shot
            src="/manual/検索条件の保存とタイトルの入力.png"
            alt="検索条件の保存とタイトルの入力"
          />

          <h2>3. LINEユーザーIDを調べる</h2>
          <ol>
            <li>
              <Link to="/users">LINEユーザー一覧</Link>
              を開きます。
            </li>
            <li>
              検索ボックスにお客様の<strong>LINEの表示名</strong>を入力して探します。
            </li>
            <li>目的のお客様の行が見つかったら、LINEユーザーIDを<strong>コピー</strong>します。</li>
          </ol>
          <Shot src="/manual/LINEのユーザID確認.png" alt="LINEの表示名で検索する" />
          <Shot src="/manual/LINEの表示名の検索結果.png" alt="LINEの表示名の検索結果" />

          <h2>4. タイトルにLINEユーザーIDを入れる</h2>
          <p>コピーしたLINEユーザーIDを、ATBBの検索条件保存のタイトルに貼り付けます。形式は次のとおりです。</p>
          <p>
            <code>{"{LINEユーザーID}_xxx"}</code>
            （<code>xxx</code> はお客様の名前など、任意のテキスト）
          </p>
          <p>
            例: <code>U1a2b3c4d5..._山田太郎</code>
          </p>
          <Shot
            src="/manual/検索条件保存のタイトル入力例.png"
            alt="検索条件保存のタイトル入力例"
          />
          <div className="note">
            この形式で保存されていて、かつそのLINEユーザーIDが
            <Link to="/users">LINEユーザー一覧</Link>に存在するお客様だけが、通知の対象になります。
          </div>

          <h2>5. 通知のしくみ</h2>
          <ul>
            <li>
              <strong>8〜22時の間、1時間ごと</strong>に更新を確認し、更新があったお客様に通知します。
            </li>
            <li>一度通知した物件と同じ物件は、再度通知しません（次の「同一物件の判定」を参照）。</li>
          </ul>

          <h2>同一物件の判定</h2>
          <p>次の4つの情報がすべて同じなら、同じ物件とみなします。</p>
          <ul>
            <li>建物名</li>
            <li>所在地</li>
            <li>間取り</li>
            <li>専有面積</li>
          </ul>
          <p>
            <strong>部屋番号と階数は同一判定に使いません。</strong>
            号室や階が違っても、間取りと専有面積が同じであれば同一物件とみなし、重複通知を避けます。
          </p>
          <p>
            <strong>家賃・管理費・管理会社情報も同一判定に使いません。</strong>
            家賃変更や管理会社側の修正で、同じ物件が再通知されるのを避けるためです。
          </p>

          <h3>同じ物件を二重に通知しないしくみ</h3>
          <ul>
            <li>
              <strong>1回の確認で同じ物件が複数見つかった場合</strong>（例: マンションA 1K 204号室 と 205号室）は、
              一覧で先に出てきた1件だけを通知します（通常は号室の若い方）。残りは通知しません。
            </li>
            <li>
              <strong>過去に通知済みの物件</strong>は、号室・階・家賃が違っても、
              建物名・所在地・間取り・専有面積が同じであれば再通知しません
              （例: 204号室を通知済みなら、後から出た 305号室も通知しない）。
            </li>
            <li>
              逆に、<strong>専有面積や間取りが違えば別物件</strong>として通知します。
              同じ「1K」でも専有面積が異なれば別物件です。
            </li>
            <li>
              判定を分けるのは家賃ではなく専有面積です。家賃が違っても専有面積などが同じなら同一物件、
              家賃が同じでも専有面積が違えば別物件です。
            </li>
          </ul>
        </div>
      </main>
    </>
  );
}
